import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitVat } from '@/lib/finance/withlocals-summary'

/** GET /api/admin/finance/getyourguide/payments — one row per payout, for the details view. */
export async function GET(_req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('getyourguide_payments')
      .select('id, payment_number, payment_run_date, invoice_number, amount_cents, storage_path')
      .order('payment_run_date', { ascending: false })

    if (error) return apiError(error.message)

    const payments = (data ?? []).map(p => {
      // Same 9%-over-net split the quarterly summary uses (aggregateGetYourGuideSummary).
      const { exCents, vatCents } = splitVat(p.amount_cents ?? 0, 9)
      return {
        id: p.id,
        paymentNumber: p.payment_number,
        paymentRunDate: p.payment_run_date,
        invoiceNumber: p.invoice_number,
        amountCents: p.amount_cents,
        revenueExCents: exCents,
        revenueVatCents: vatCents,
        hasAttachment: !!p.storage_path,
      }
    })

    return apiOk({ payments })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
