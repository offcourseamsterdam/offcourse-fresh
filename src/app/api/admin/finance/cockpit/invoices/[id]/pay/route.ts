import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid, invoicePaySchema, parseBody } from '@/lib/finance/cockpit/schemas'
import { addDays, todayISO } from '@/lib/finance/cockpit/dates'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'
import { isValidIban, normalizeIban } from '@/lib/finance/iban'
import type { ExtractedInvoiceFields, InvoiceCheck } from '@/lib/finance/invoices/match'
import { ensureInvoiceObligation, recordInvoiceDecision, resolvePayableAmount, supersedeCrewAccrual } from '@/lib/finance/invoices/decide'

export const dynamic = 'force-dynamic'

const DEFAULT_DUE_DAYS = 14

/**
 * POST /api/admin/finance/cockpit/invoices/[id]/pay {note?, amount_cents?}
 *
 * §6: "Goedkeuren & betalen → Revolut payment draft → payment_pending (Beer
 * approves in the Revolut app)". A payment DRAFT, not an executed payment —
 * Revolut requires a human to open the app and confirm it; nothing here can
 * actually move money on its own.
 *
 * Retry-safe by construction (2026-09-04 review). Steps, each idempotent:
 *   1. amount via resolvePayableAmount — never Gemini's number when the
 *      `amount` check failed; IBAN mod-97 checked before it can become a payee
 *   2. counterparty: reuse finance_suppliers.revolut_counterparty_id, create once
 *   3. draft: reuse finance_invoices.revolut_draft_id if a previous attempt got
 *      this far, else create AND persist the id immediately — so a failure one
 *      step later can't leave a second draft in Beer's Revolut app on retry
 *   4. obligation: exactly one per invoice (unique index + reuse on 23505)
 *   5. decision: written once (decision IS NULL guard) → 409 on a race
 *   6. supersede the crew-hours accrual this invoice's shift belonged to
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid invoice id', 400)
  const parsed = await parseBody(request, invoicePaySchema)
  if (!parsed.ok) return parsed.response

  try {
    const supabase = createAdminClient()
    const { data: invoice, error: fetchErr } = await supabase
      .from('finance_invoices')
      .select('*, supplier:finance_suppliers(id, name, iban, default_boat_id, revolut_counterparty_id)')
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

    if (!invoice.supplier?.iban) {
      return apiError('No known IBAN for this supplier — link one before paying', 400)
    }
    const iban = normalizeIban(invoice.supplier.iban)
    if (!isValidIban(iban)) {
      return apiError('The supplier IBAN on file fails its checksum — correct it before paying', 400)
    }

    const connectionRow = await loadConnection(supabase)
    if (!isConnected(connectionRow)) return apiError('Revolut is not connected', 400)
    if (!connectionRow.account_id) return apiError('No Revolut account selected to pay from', 400)

    const client = await createRevolutClient(supabase)
    const supplierName = invoice.supplier.name
    const title = `Factuur ${supplierName}${extracted?.invoiceNumber ? ` #${extracted.invoiceNumber}` : ''}`

    // Reuse an existing counterparty for this supplier; only create one the first time.
    let counterpartyId = invoice.supplier.revolut_counterparty_id
    if (!counterpartyId) {
      const counterparty = await client.createCounterparty({
        company_name: supplierName,
        bank_country: iban.slice(0, 2),
        currency: 'EUR',
        iban,
      })
      counterpartyId = counterparty.id
      await supabase.from('finance_suppliers').update({ revolut_counterparty_id: counterpartyId }).eq('id', invoice.supplier.id)
    }

    // Reuse a draft a previous attempt already created; otherwise create one
    // and pin its id to the invoice BEFORE touching anything else.
    let draftId = invoice.revolut_draft_id
    if (!draftId) {
      const draft = await client.createPaymentDraft({
        title,
        payments: [
          {
            account_id: connectionRow.account_id,
            receiver: { counterparty_id: counterpartyId },
            amount: amount.amountCents / 100,
            currency: 'EUR',
            reference: title.slice(0, 140),
          },
        ],
      })
      draftId = draft.id
      const { error: pinErr } = await supabase.from('finance_invoices').update({ revolut_draft_id: draftId }).eq('id', id)
      if (pinErr) throw new Error(`Payment draft ${draftId} created but could not be recorded: ${pinErr.message}`)
    }

    const dueDate = extracted?.invoiceDate ? addDays(extracted.invoiceDate, DEFAULT_DUE_DAYS) : addDays(todayISO(), DEFAULT_DUE_DAYS)
    const decision = invoice.status === 'ready' ? 'approved' : 'approved_override'

    const obligation = await ensureInvoiceObligation(supabase, {
      invoiceId: invoice.id,
      title,
      amountCents: amount.amountCents,
      dueDate,
      boatId: invoice.supplier.default_boat_id ?? null,
    })

    const updated = await recordInvoiceDecision(supabase, id, {
      status: 'payment_pending',
      decision,
      decision_note: parsed.data.note ?? null,
      obligation_id: obligation.id,
      revolut_draft_id: draftId,
    })
    if (!updated) return apiError('Invoice was already decided by another request', 409)

    const superseded = await supersedeCrewAccrual(supabase, { invoiceId: id, matchedShiftId: invoice.matched_shift_id, amountCents: amount.amountCents })

    await logFinanceEvent(supabase, {
      event_type: 'invoice_payment_drafted',
      actor: 'user',
      entity_type: 'invoice',
      entity_id: id,
      delta_cents: amount.amountCents,
      payload: {
        title,
        decision,
        obligation_id: obligation.id,
        obligation_reused: obligation.reused,
        revolut_draft_id: draftId,
        due_date: dueDate,
        amount_source: amount.source,
        superseded_crew_obligation_id: superseded?.obligationId ?? null,
      },
    })

    return apiOk({ ...updated, amount_source: amount.source, superseded })
  } catch (err) {
    console.error('[finance/cockpit/invoices/[id]/pay]', err)
    return apiError(err instanceof Error ? err.message : 'Could not draft the payment', 500)
  }
}
