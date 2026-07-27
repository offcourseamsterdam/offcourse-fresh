import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { splitVat } from '@/lib/finance/withlocals-summary'

/**
 * GET /api/admin/finance/viator/batches
 *
 * One row per uploaded payment advice, each with its line items — the
 * "click through for details" view behind the quarterly summary.
 */
export async function GET(_req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('viator_payment_batches')
      .select(`
        id, document_number, advice_date, total_amount_cents, raw_filename, storage_path,
        viator_payment_lines (
          id, viator_reference, arrival_date, sale_date, gross_amount, gross_currency,
          converted_amount_cents, tour_grade_title
        )
      `)
      .order('advice_date', { ascending: false })

    if (error) return apiError(error.message)

    const batches = (data ?? []).map(b => {
      // Same 9%-over-net split the quarterly summary uses (aggregateViatorSummary).
      const { exCents, vatCents } = splitVat(b.total_amount_cents ?? 0, 9)
      return {
        id: b.id,
        documentNumber: b.document_number,
        adviceDate: b.advice_date,
        totalAmountCents: b.total_amount_cents,
        revenueExCents: exCents,
        revenueVatCents: vatCents,
        rawFilename: b.raw_filename,
        hasAttachment: !!b.storage_path,
        lines: (b.viator_payment_lines ?? []).map(l => ({
          id: l.id,
          viatorReference: l.viator_reference,
          arrivalDate: l.arrival_date,
          saleDate: l.sale_date,
          grossAmount: l.gross_amount,
          grossCurrency: l.gross_currency,
          convertedAmountCents: l.converted_amount_cents,
          tourGradeTitle: l.tour_grade_title,
        })),
      }
    })

    return apiOk({ batches })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
