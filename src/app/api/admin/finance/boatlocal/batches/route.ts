import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/finance/boatlocal/batches
 *
 * One row per uploaded invoice, each with its booking lines — the
 * "click through for details" view behind the quarterly summary.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('boatlocal_payout_batches')
      .select(`
        id, invoice_number, issue_date, period_start, period_end,
        total_sales_incl_vat_cents, commission_ex_vat_cents, vat_21_cents,
        total_withheld_cents, operator_payout_cents, vat_9_in_payout_cents, storage_path,
        boatlocal_payout_lines (
          id, booking_date, guest_name, guest_count, cruise_name, total_cents, ex_vat_cents, incl_vat_cents
        )
      `)
      .order('issue_date', { ascending: false })

    if (error) return apiError(error.message)

    const batches = (data ?? []).map(b => ({
      id: b.id,
      invoiceNumber: b.invoice_number,
      issueDate: b.issue_date,
      periodStart: b.period_start,
      periodEnd: b.period_end,
      totalSalesInclVatCents: b.total_sales_incl_vat_cents,
      commissionExVatCents: b.commission_ex_vat_cents,
      vat21Cents: b.vat_21_cents,
      totalWithheldCents: b.total_withheld_cents,
      operatorPayoutCents: b.operator_payout_cents,
      vat9InPayoutCents: b.vat_9_in_payout_cents,
      hasAttachment: !!b.storage_path,
      lines: (b.boatlocal_payout_lines ?? []).map(l => ({
        id: l.id,
        bookingDate: l.booking_date,
        guestName: l.guest_name,
        guestCount: l.guest_count,
        cruiseName: l.cruise_name,
        totalCents: l.total_cents,
        exVatCents: l.ex_vat_cents,
        inclVatCents: l.incl_vat_cents,
      })),
    }))

    return apiOk({ batches })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
