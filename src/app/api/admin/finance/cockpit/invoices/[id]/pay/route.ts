import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid, invoicePaySchema, parseBody } from '@/lib/finance/cockpit/schemas'
import { addDays, todayISO } from '@/lib/finance/cockpit/dates'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'
import type { ExtractedInvoiceFields } from '@/lib/finance/invoices/match'

export const dynamic = 'force-dynamic'

const DEFAULT_DUE_DAYS = 14

/**
 * POST /api/admin/finance/cockpit/invoices/[id]/pay {note?}
 *
 * §6: "Goedkeuren & betalen → Revolut payment draft → payment_pending (Beer
 * approves in the Revolut app)". A payment DRAFT, not an executed payment —
 * Revolut requires a human to open the app and confirm it; nothing here can
 * actually move money on its own. Does everything plain approve does
 * (creates the finance_obligations row) plus drafts the transfer, so
 * approving-and-paying never leaves an invoice half-done between the two.
 *
 * Resolves a Revolut counterparty for the supplier on first use and caches
 * its id on finance_suppliers — every later invoice from the same skipper/
 * supplier reuses it instead of creating a duplicate payee in Revolut.
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
    const amountCents = extracted?.amountCents ?? invoice.expected_amount_cents
    if (!amountCents || amountCents <= 0) {
      return apiError('No amount on this invoice to pay — fix the extraction or reject it instead', 400)
    }
    if (!invoice.supplier?.iban) {
      return apiError('No known IBAN for this supplier — link one before paying', 400)
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
      const iban = invoice.supplier.iban.replace(/\s+/g, '').toUpperCase()
      const counterparty = await client.createCounterparty({
        company_name: supplierName,
        bank_country: iban.slice(0, 2),
        currency: 'EUR',
        iban,
      })
      counterpartyId = counterparty.id
      await supabase.from('finance_suppliers').update({ revolut_counterparty_id: counterpartyId }).eq('id', invoice.supplier.id)
    }

    const dueDate = extracted?.invoiceDate ? addDays(extracted.invoiceDate, DEFAULT_DUE_DAYS) : addDays(todayISO(), DEFAULT_DUE_DAYS)
    const decision = invoice.status === 'ready' ? 'approved' : 'approved_override'

    const { data: obligation, error: obligationErr } = await supabase
      .from('finance_obligations')
      .insert({
        title,
        kind: 'invoice',
        amount_cents: amountCents,
        due_date: dueDate,
        boat_id: invoice.supplier.default_boat_id ?? null,
        invoice_id: invoice.id,
        status: 'open',
      })
      .select('id')
      .single()
    if (obligationErr || !obligation) return apiError(obligationErr?.message ?? 'Could not create obligation', 500)

    const draft = await client.createPaymentDraft({
      title,
      payments: [
        {
          account_id: connectionRow.account_id,
          receiver: { counterparty_id: counterpartyId },
          amount: amountCents / 100,
          currency: 'EUR',
          reference: title.slice(0, 140),
        },
      ],
    })

    const { data: updated, error: updateErr } = await supabase
      .from('finance_invoices')
      .update({
        status: 'payment_pending',
        decision,
        decided_by: 'admin',
        decided_at: new Date().toISOString(),
        decision_note: parsed.data.note ?? null,
        obligation_id: obligation.id,
        revolut_draft_id: draft.id,
      })
      .eq('id', id)
      .select('*')
      .single()
    if (updateErr || !updated) return apiError(updateErr?.message ?? 'Could not update invoice', 500)

    await logFinanceEvent(supabase, {
      event_type: 'invoice_payment_drafted',
      actor: 'user',
      entity_type: 'invoice',
      entity_id: id,
      delta_cents: amountCents,
      payload: { title, decision, obligation_id: obligation.id, revolut_draft_id: draft.id, due_date: dueDate },
    })

    return apiOk(updated)
  } catch (err) {
    console.error('[finance/cockpit/invoices/[id]/pay]', err)
    return apiError(err instanceof Error ? err.message : 'Could not draft the payment', 500)
  }
}
