/**
 * The shared spine of "Goedkeuren" and "Goedkeuren & betalen"
 * (api/admin/finance/cockpit/invoices/[id]/{approve,pay}/route.ts).
 *
 * Both routes used to inline the same four steps and got the same two things
 * wrong: they inserted the obligation before anything could still fail (so a
 * Revolut hiccup + a retry deducted the invoice twice), and they paid whatever
 * number Gemini had read off the PDF even when the `amount` check had just
 * said that number was wrong. The 2026-09-04 review found both; this module is
 * the fix, shared so the two routes can't drift apart again.
 *
 * Three rules, in plain terms:
 *  1. Never pay an unchecked amount. If the PDF's amount disagrees with what
 *     hours × rate says we owe, we pay what we owe — or Beer types the number
 *     himself. The model's reading is never the final word on money.
 *  2. Exactly one obligation per invoice. The partial unique index from
 *     migration 158 enforces it; here we turn the 23505 into "reuse the row".
 *  3. A decision is written once. The update is conditional on
 *     decision IS NULL, so two clicks (or a retry racing the first request)
 *     can't both "win".
 *
 * And plan §12b rule 2: an approved skipper invoice supersedes the crew-hours
 * accrual for the shift it matched — the same hours must not sit in
 * "Komende verplichtingen" twice, once as accrual and once as invoice.
 */
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import type { ExtractedInvoiceFields, InvoiceCheck } from './match'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * €25.000. No skipper, marina or insurer invoice at this company comes anywhere
 * near it; a Gemini misread of "1.500,00" as 150000000 must never turn into a
 * Revolut draft. Deliberately a hard ceiling, not a warning.
 */
export const MAX_INVOICE_AMOUNT_CENTS = 2_500_000

export type AmountSource = 'override' | 'extracted' | 'expected'

export type PayableAmount =
  | { ok: true; amountCents: number; source: AmountSource }
  | {
      ok: false
      error: string
      /** When set, the UI pre-fills an amount field with this and asks Beer to confirm it. */
      suggestedCents: number | null
    }

export interface InvoiceForAmount {
  extracted: ExtractedInvoiceFields | null
  expected_amount_cents: number | null
  checks: InvoiceCheck[]
}

function inRange(cents: number): boolean {
  return Number.isInteger(cents) && cents > 0 && cents <= MAX_INVOICE_AMOUNT_CENTS
}

/**
 * Which number is allowed to become an obligation / a Revolut draft.
 *
 *  - Beer typed one (`override`) → that, range-checked.
 *  - Extraction found an amount AND the `amount` check passed → the extracted amount.
 *  - The `amount` check failed but we know what hours × rate says → the expected
 *    amount (the caller should tell Beer which number it used).
 *  - No expectation exists (a non-skipper supplier: nothing to compute against)
 *    → not ok, but with `suggestedCents` = the extracted amount so the UI can
 *    ask "is €X right?" instead of making Beer retype it.
 *  - Nothing at all → not ok, no suggestion.
 */
export function resolvePayableAmount(invoice: InvoiceForAmount, override?: number | null): PayableAmount {
  if (override != null) {
    return inRange(override)
      ? { ok: true, amountCents: override, source: 'override' }
      : { ok: false, error: `Bedrag moet tussen €0,01 en €${(MAX_INVOICE_AMOUNT_CENTS / 100).toLocaleString('nl-NL')} liggen`, suggestedCents: null }
  }

  const extracted = invoice.extracted?.amountCents ?? null
  const expected = invoice.expected_amount_cents
  const amountCheck = invoice.checks.find(c => c.key === 'amount')

  if (extracted != null && amountCheck?.ok) {
    return inRange(extracted)
      ? { ok: true, amountCents: extracted, source: 'extracted' }
      : { ok: false, error: 'Factuurbedrag valt buiten het toegestane bereik — voer het bedrag zelf in', suggestedCents: null }
  }
  if (expected != null && inRange(expected)) {
    return { ok: true, amountCents: expected, source: 'expected' }
  }
  if (extracted != null) {
    return {
      ok: false,
      error: 'Bedrag kon niet worden gecontroleerd — bevestig het bedrag',
      suggestedCents: inRange(extracted) ? extracted : null,
    }
  }
  return { ok: false, error: 'Geen bedrag op deze factuur gevonden — voer het bedrag in of wijs de factuur af', suggestedCents: null }
}

export interface EnsureObligationInput {
  invoiceId: string
  title: string
  amountCents: number
  dueDate: string
  boatId: string | null
}

/**
 * The one finance_obligations row for this invoice. A first call inserts it; a
 * retry after a mid-way failure hits the unique index (23505) and reuses the
 * row that already exists instead of deducting the invoice a second time.
 */
export async function ensureInvoiceObligation(
  supabase: SupabaseAdmin,
  input: EnsureObligationInput,
): Promise<{ id: string; reused: boolean }> {
  const { data, error } = await supabase
    .from('finance_obligations')
    .insert({
      title: input.title,
      kind: 'invoice',
      amount_cents: input.amountCents,
      due_date: input.dueDate,
      boat_id: input.boatId,
      invoice_id: input.invoiceId,
      status: 'open',
    })
    .select('id')
    .single()
  if (!error && data) return { id: data.id, reused: false }

  if (error?.code === '23505') {
    const { data: existing } = await supabase.from('finance_obligations').select('id').eq('invoice_id', input.invoiceId).maybeSingle()
    if (existing) return { id: existing.id, reused: true }
  }
  throw new Error(error?.message ?? 'Could not create obligation')
}

export interface DecisionPatch {
  status: 'approved' | 'payment_pending'
  decision: 'approved' | 'approved_override'
  decision_note: string | null
  obligation_id: string
  revolut_draft_id?: string
}

/**
 * Writes the decision exactly once: `decision IS NULL` is part of the WHERE, so
 * the second of two racing requests updates zero rows and gets null back — the
 * caller turns that into 409 rather than overwriting the first decision.
 */
export async function recordInvoiceDecision(supabase: SupabaseAdmin, invoiceId: string, patch: DecisionPatch) {
  const { data, error } = await supabase
    .from('finance_invoices')
    .update({
      ...patch,
      decided_by: 'admin',
      decided_at: new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .is('decision', null)
    .select('*')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * Plan §12b rule 2. The crew accrual (kind='crew', source_key
 * 'skipper-hours:YYYY-MM:<staffId>', see obligations/derived/skipper-hours)
 * is one row per skipper per MONTH; an invoice usually covers one shift, and
 * a skipper may well send two PDFs for one month or one PDF for two shifts.
 * So "supersede" is arithmetic, not a flip: the invoice amount comes off the
 * month's accrual, and the accrual is cancelled only once nothing is left.
 * Otherwise approving the first invoice of the month would silently drop the
 * other three shifts from "Komende verplichtingen".
 *
 * Returns what happened for the event payload / UI; null when this invoice
 * matched no shift (nothing to supersede — a marina invoice, say).
 */
export async function supersedeCrewAccrual(
  supabase: SupabaseAdmin,
  input: { invoiceId: string; matchedShiftId: string | null; amountCents: number },
): Promise<{ obligationId: string; sourceKey: string; remainingCents: number; cancelled: boolean } | null> {
  if (!input.matchedShiftId) return null

  const { data: shift } = await supabase.from('shifts').select('staff_id, date').eq('id', input.matchedShiftId).maybeSingle()
  if (!shift?.staff_id) return null

  const sourceKey = `skipper-hours:${shift.date.slice(0, 7)}:${shift.staff_id}`
  const { data: accrual } = await supabase
    .from('finance_obligations')
    .select('id, amount_cents, notes')
    .eq('source_key', sourceKey)
    .eq('status', 'open')
    .maybeSingle()
  if (!accrual) return null

  const remainingCents = Math.max(0, accrual.amount_cents - input.amountCents)
  const cancelled = remainingCents === 0
  const marker = `Factuur ${input.invoiceId} goedgekeurd: ${cancelled ? 'volledig vervangen door factuur' : `€${(input.amountCents / 100).toFixed(2)} verrekend`}.`

  const { error } = await supabase
    .from('finance_obligations')
    .update({
      amount_cents: remainingCents,
      status: cancelled ? 'cancelled' : 'open',
      notes: [accrual.notes, marker].filter(Boolean).join('\n'),
    })
    .eq('id', accrual.id)
  if (error) throw new Error(error.message)

  await logFinanceEvent(supabase, {
    event_type: cancelled ? 'obligation_cancelled' : 'obligation_updated',
    actor: 'system',
    entity_type: 'obligation',
    entity_id: accrual.id,
    delta_cents: -Math.min(accrual.amount_cents, input.amountCents),
    payload: { reason: 'superseded_by_invoice', invoice_id: input.invoiceId, source_key: sourceKey, remaining_cents: remainingCents },
  })

  return { obligationId: accrual.id, sourceKey, remainingCents, cancelled }
}
