import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadPayoutCandidatePool, matchTransactionToPayout } from '@/lib/finance/cockpit/reconcile/channel-matcher'
import { logFinanceEvent } from '@/lib/finance/cockpit/events'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/finance/cockpit/transactions/reconcile-payouts
 *
 * Scans incoming bank deposits (amount_cents > 0) that haven't been reconciled
 * to a payout yet (payout_record_id IS NULL). Matches them against Kasboek
 * payout records (Viator, GetYourGuide, BoatLocal, FareHarbor), updates
 * bank_transactions with channel, record ID, payout reference, and VAT,
 * and sets bank_transaction_id on the payout batch record.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()

    // 1. Fetch unlinked revenue deposits
    const { data: rows, error } = await supabase
      .from('bank_transactions')
      .select('id, amount_cents, description, reference, created_at, category, subcategory')
      .gt('amount_cents', 0)
      .is('payout_record_id', null)
      .order('created_at', { ascending: false })

    if (error) return apiError(error.message, 500)

    const transactions = rows ?? []
    if (transactions.length === 0) {
      return apiOk({ total: 0, reconciled: 0, matches: [] })
    }

    // 2. Load candidates from Kasboek payout tables
    const pool = await loadPayoutCandidatePool(supabase)

    const matchedResults: Array<{
      transactionId: string
      channel: string
      recordId: string
      reference: string
      amountCents: number
      vatCents: number
    }> = []

    for (const tx of transactions) {
      const match = matchTransactionToPayout(
        {
          amountCents: tx.amount_cents,
          description: tx.description,
          reference: tx.reference,
          createdAt: tx.created_at,
        },
        pool,
      )

      if (match && match.confidence >= 0.95) {
        const vatCents = match.vat9Cents + match.vat21Cents
        const now = new Date().toISOString()

        // Update bank_transaction
        const updatePayload: Record<string, unknown> = {
          payout_channel: match.channel,
          payout_record_id: match.recordId,
          payout_reference: match.reference,
          reconciled_at: now,
          vat_cents: vatCents,
        }

        // Also ensure category is booking_revenue if not yet categorized
        if (!tx.category) {
          updatePayload.category = 'booking_revenue'
          updatePayload.subcategory = match.channelLabel
          updatePayload.confidence = 1.0
          updatePayload.classified_by = 'rule'
          updatePayload.classification_reason = match.reason
          updatePayload.needs_review = false
        }

        await supabase.from('bank_transactions').update(updatePayload as never).eq('id', tx.id)

        // Two-way link back to payout table
        if (match.channel === 'viator') {
          await supabase.from('viator_payment_batches').update({ bank_transaction_id: tx.id } as never).eq('id', match.recordId)
        } else if (match.channel === 'getyourguide') {
          await supabase.from('getyourguide_payments').update({ bank_transaction_id: tx.id } as never).eq('id', match.recordId)
        } else if (match.channel === 'boatlocal') {
          await supabase.from('boatlocal_payout_batches').update({ bank_transaction_id: tx.id } as never).eq('id', match.recordId)
        }

        matchedResults.push({
          transactionId: tx.id,
          channel: match.channel,
          recordId: match.recordId,
          reference: match.reference,
          amountCents: tx.amount_cents,
          vatCents,
        })

        await logFinanceEvent(supabase, {
          event_type: 'transaction_classified',
          actor: 'cron',
          entity_type: 'transaction',
          entity_id: tx.id,
          delta_cents: null,
          payload: {
            payout_channel: match.channel,
            payout_record_id: match.recordId,
            payout_reference: match.reference,
            reason: match.reason,
            vat_cents: vatCents,
          },
        })
      }
    }

    return apiOk({
      total: transactions.length,
      reconciled: matchedResults.length,
      matches: matchedResults,
    })
  } catch (err) {
    console.error('[finance/cockpit/transactions/reconcile-payouts]', err)
    return apiError(err instanceof Error ? err.message : 'Could not reconcile payouts', 500)
  }
}
