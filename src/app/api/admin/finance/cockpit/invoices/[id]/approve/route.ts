import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid, invoiceApproveSchema, parseBody } from '@/lib/finance/cockpit/schemas'
import { addDays, todayISO } from '@/lib/finance/cockpit/dates'
import type { ExtractedInvoiceFields, InvoiceCheck } from '@/lib/finance/invoices/match'
import { ensureInvoiceObligation, recordInvoiceDecision, resolvePayableAmount, supersedeCrewAccrual } from '@/lib/finance/invoices/decide'

export const dynamic = 'force-dynamic'

const DEFAULT_DUE_DAYS = 14

/**
 * POST /api/admin/finance/cockpit/invoices/[id]/approve {note?, amount_cents?}
 *
 * §6: "Goedkeuren → approved + finance_obligations row (kind='invoice')".
 * Records decision='approved' when every check passed, 'approved_override'
 * when Beer is overriding a needs_review invoice — the checks themselves are
 * never edited (see match.ts's own doc comment), only the human's decision
 * on top of them.
 *
 * The amount that becomes the obligation is decided by resolvePayableAmount
 * (invoices/decide.ts): the extracted number only when the `amount` check
 * passed, otherwise hours × rate, otherwise a number Beer typed in
 * `amount_cents`. Never Gemini's reading when the pipeline just said it was
 * wrong. Order of writes is obligation → decision → supersede, each step
 * idempotent, so a retry after a failure can't double-count (see decide.ts).
 *
 * Deliberately doesn't create a Revolut payment draft — that's pay/route.ts.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid invoice id', 400)
  const parsed = await parseBody(request, invoiceApproveSchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: invoice, error: fetchErr } = await supabase
      .from('finance_invoices')
      .select('*, supplier:finance_suppliers(id, name, default_boat_id)')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!invoice) return apiError('Invoice not found', 404)
    if (invoice.decision) return apiError(`Invoice already ${invoice.decision === 'rejected' ? 'rejected' : 'approved'}`, 400)

    const extracted = invoice.extracted as unknown as ExtractedInvoiceFields | null
    const amount = resolvePayableAmount(
      { extracted, expected_amount_cents: invoice.expected_amount_cents, checks: (invoice.checks as unknown as InvoiceCheck[]) ?? [] },
      parsed.data.amount_cents,
    )
    if (!amount.ok) return apiError(amount.error, 400, { suggested_cents: amount.suggestedCents })

    const dueDate = extracted?.invoiceDate ? addDays(extracted.invoiceDate, DEFAULT_DUE_DAYS) : addDays(todayISO(), DEFAULT_DUE_DAYS)
    const decision = invoice.status === 'ready' ? 'approved' : 'approved_override'
    const supplierName = invoice.supplier?.name ?? extracted?.supplierName ?? 'onbekende leverancier'
    const title = `Factuur ${supplierName}${extracted?.invoiceNumber ? ` #${extracted.invoiceNumber}` : ''}`

    const obligation = await ensureInvoiceObligation(supabase, {
      invoiceId: invoice.id,
      title,
      amountCents: amount.amountCents,
      dueDate,
      boatId: invoice.supplier?.default_boat_id ?? null,
    })

    const updated = await recordInvoiceDecision(supabase, id, {
      status: 'approved',
      decision,
      decision_note: parsed.data.note ?? null,
      obligation_id: obligation.id,
    })
    if (!updated) return apiError('Invoice was already decided by another request', 409)

    const superseded = await supersedeCrewAccrual(supabase, { invoiceId: id, matchedShiftId: invoice.matched_shift_id, amountCents: amount.amountCents })

    await logFinanceEvent(supabase, {
      event_type: 'invoice_approved',
      actor: 'user',
      entity_type: 'invoice',
      entity_id: id,
      delta_cents: amount.amountCents,
      payload: {
        title,
        decision,
        obligation_id: obligation.id,
        obligation_reused: obligation.reused,
        due_date: dueDate,
        amount_source: amount.source,
        superseded_crew_obligation_id: superseded?.obligationId ?? null,
      },
    })

    return apiOk({ ...updated, amount_source: amount.source, superseded })
  } catch (err) {
    console.error('[finance/cockpit/invoices/[id]/approve]', err)
    return apiError(err instanceof Error ? err.message : 'Could not approve invoice', 500)
  }
}
