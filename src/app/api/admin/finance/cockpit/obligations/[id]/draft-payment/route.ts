import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'
import { isUuid } from '@/lib/finance/cockpit/schemas'
import { createRevolutClient, loadConnection, isConnected } from '@/lib/revolut/token-store'
import { DRAFT_REFUSAL_TEXT, createSinglePaymentDraft, ensureRevolutCounterparty, validateSupplierForDraft } from '@/lib/revolut/draft-payment'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/finance/cockpit/obligations/[id]/draft-payment — no body.
 *
 * Drafts a Revolut payment for the obligation's linked supplier, for the CURRENT due amount.
 * Never marks anything paid — that still only happens through mark-paid or the normal bank-sync
 * classifier once Beer approves the draft in the Revolut app. Idempotent: a second click reuses
 * the pinned draft id instead of creating a duplicate.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { id } = await params
  if (!isUuid(id)) return apiError('Invalid obligation id', 400)

  try {
    const supabase = createAdminClient()
    const { data: obligation, error: fetchErr } = await supabase
      .from('finance_obligations')
      .select('*, supplier:finance_suppliers(id, name, iban, revolut_counterparty_id)')
      .eq('id', id)
      .maybeSingle()
    if (fetchErr) return apiError(fetchErr.message, 500)
    if (!obligation) return apiError('Obligation not found', 404)
    if (obligation.status !== 'open') return apiError(`This obligation is ${obligation.status} — only an open obligation can be drafted`, 409)

    if (!obligation.revolut_draft_id) {
      const validated = validateSupplierForDraft(obligation.supplier)
      if (!validated.ok) return apiError(DRAFT_REFUSAL_TEXT[validated.reason], 409, { reason: validated.reason })

      const connectionRow = await loadConnection(supabase)
      if (!isConnected(connectionRow)) return apiError('Revolut is not connected', 400)
      if (!connectionRow.account_id) return apiError('No Revolut account selected to pay from', 400)

      const client = await createRevolutClient(supabase)
      const counterpartyId = await ensureRevolutCounterparty(supabase, client, obligation.supplier!, validated.iban)
      const draftId = await createSinglePaymentDraft(client, {
        accountId: connectionRow.account_id,
        counterpartyId,
        amountCents: obligation.amount_cents,
        title: obligation.title,
        reference: obligation.title,
      })

      const { error: pinErr } = await supabase.from('finance_obligations').update({ revolut_draft_id: draftId, updated_at: new Date().toISOString() }).eq('id', id)
      if (pinErr) throw new Error(`Payment draft ${draftId} created but could not be recorded: ${pinErr.message}`)
      obligation.revolut_draft_id = draftId

      await logFinanceEvent(supabase, {
        event_type: 'obligation_payment_drafted',
        actor: 'user',
        entity_type: 'obligation',
        entity_id: id,
        delta_cents: obligation.amount_cents,
        payload: { title: obligation.title, supplier_id: obligation.supplier!.id, revolut_draft_id: draftId },
      })
    }

    return apiOk({ id: obligation.id, revolut_draft_id: obligation.revolut_draft_id })
  } catch (err) {
    console.error('[finance/cockpit/obligations/[id]/draft-payment]', err)
    return apiError(err instanceof Error ? err.message : 'Could not draft the payment', 500)
  }
}
