import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid, invoiceApproveSchema, parseBody } from '@/lib/finance/cockpit/schemas'
import { addDays, todayISO } from '@/lib/finance/cockpit/dates'
import type { ExtractedInvoiceFields } from '@/lib/finance/invoices/match'

export const dynamic = 'force-dynamic'

const DEFAULT_DUE_DAYS = 14

/**
 * POST /api/admin/finance/cockpit/invoices/[id]/approve {note?}
 *
 * §6: "Goedkeuren → approved + finance_obligations row (kind='invoice')".
 * Records decision='approved' when every check passed, 'approved_override'
 * when Beer is overriding a needs_review invoice — the checks themselves are
 * never edited (see match.ts's own doc comment), only the human's decision
 * on top of them. Requires an extracted amount: with nothing to pay, there's
 * nothing to create an obligation for — reject or fix the PDF instead.
 *
 * Deliberately doesn't create a Revolut payment draft yet ("Goedkeuren &
 * betalen" in the plan) — that's the next piece; this just gets the invoice
 * into the obligations list so it's not lost, the same way a manually
 * entered obligation would be.
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
    const amountCents = extracted?.amountCents ?? invoice.expected_amount_cents
    if (!amountCents || amountCents <= 0) {
      return apiError('No amount on this invoice to approve — fix the extraction or reject it instead', 400)
    }

    const dueDate = extracted?.invoiceDate ? addDays(extracted.invoiceDate, DEFAULT_DUE_DAYS) : addDays(todayISO(), DEFAULT_DUE_DAYS)
    const decision = invoice.status === 'ready' ? 'approved' : 'approved_override'
    const supplierName = invoice.supplier?.name ?? extracted?.supplierName ?? 'onbekende leverancier'
    const title = `Factuur ${supplierName}${extracted?.invoiceNumber ? ` #${extracted.invoiceNumber}` : ''}`

    const { data: obligation, error: obligationErr } = await supabase
      .from('finance_obligations')
      .insert({
        title,
        kind: 'invoice',
        amount_cents: amountCents,
        due_date: dueDate,
        boat_id: invoice.supplier?.default_boat_id ?? null,
        invoice_id: invoice.id,
        status: 'open',
      })
      .select('id')
      .single()
    if (obligationErr || !obligation) return apiError(obligationErr?.message ?? 'Could not create obligation', 500)

    const { data: updated, error: updateErr } = await supabase
      .from('finance_invoices')
      .update({
        status: 'approved',
        decision,
        decided_by: 'admin',
        decided_at: new Date().toISOString(),
        decision_note: parsed.data.note ?? null,
        obligation_id: obligation.id,
      })
      .eq('id', id)
      .select('*')
      .single()
    if (updateErr || !updated) return apiError(updateErr?.message ?? 'Could not update invoice', 500)

    await logFinanceEvent(supabase, {
      event_type: 'invoice_approved',
      actor: 'user',
      entity_type: 'invoice',
      entity_id: id,
      delta_cents: amountCents,
      payload: { title, decision, obligation_id: obligation.id, due_date: dueDate },
    })

    return apiOk(updated)
  } catch (err) {
    console.error('[finance/cockpit/invoices/[id]/approve]', err)
    return apiError(err instanceof Error ? err.message : 'Could not approve invoice', 500)
  }
}
