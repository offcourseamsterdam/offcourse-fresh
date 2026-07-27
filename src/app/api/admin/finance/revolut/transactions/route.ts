import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { guessRevolutVatSplit } from '@/lib/finance/revolut-statement'

/**
 * GET /api/admin/finance/revolut/transactions — every stored transaction,
 * newest first. Feeds the Revolut tab's classify list. Each row includes a
 * `suggestedVat9GrossCents`/`suggestedVat21GrossCents` pair (a keyword-based
 * guess, only for descriptions that unambiguously match one side) to
 * pre-fill the classify form — never treated as final, always editable.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('revolut_transactions')
      .select('*')
      .order('payout_date', { ascending: false, nullsFirst: true })

    if (error) return apiError(error.message)

    const transactions = (data ?? []).map(t => {
      const isClassified = t.vat9_gross_cents != null || t.vat21_gross_cents != null
      const suggestion = isClassified ? null : guessRevolutVatSplit(t.description, t.original_amount_cents)
      return {
        id: t.id,
        transactionId: t.transaction_id,
        occurredAt: t.occurred_at,
        payoutDate: t.payout_date,
        description: t.description,
        customerName: t.customer_name,
        originalAmountCents: t.original_amount_cents,
        settlementAmountCents: t.settlement_amount_cents,
        processingFeeCents: t.processing_fee_cents,
        vat9GrossCents: t.vat9_gross_cents,
        vat21GrossCents: t.vat21_gross_cents,
        isClassified,
        suggestedVat9GrossCents: suggestion?.vat9GrossCents ?? null,
        suggestedVat21GrossCents: suggestion?.vat21GrossCents ?? null,
      }
    })

    return apiOk({ transactions })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
