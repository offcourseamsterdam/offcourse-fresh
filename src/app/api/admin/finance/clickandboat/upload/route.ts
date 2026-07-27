import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseClickAndBoatCsv } from '@/lib/finance/clickandboat-csv'

const MAX_SIZE_BYTES = 1024 * 1024 // plain text CSV, generous headroom

/**
 * POST /api/admin/finance/clickandboat/upload
 *
 * Upload the "Download the summary" CSV export from
 * clickandboat.com/en/account/bookings. The file always covers the FULL
 * booking history (not incremental), so this is safe to re-upload anytime —
 * every row upserts by charter_number, a stable no-op for bookings already
 * stored.
 *
 * Body: FormData { file }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return apiError('file is required', 400)
    if (!file.name.toLowerCase().endsWith('.csv')) return apiError('Expected a .csv file', 400)
    if (file.size > MAX_SIZE_BYTES) return apiError('File too large', 400)

    const csvText = await file.text()
    const rows = parseClickAndBoatCsv(csvText)
    if (rows.length === 0) return apiError('No booking rows found — is this the Click & Boat revenue summary export?', 400)

    const supabase = createAdminClient()

    const { data: upserted, error } = await supabase
      .from('clickandboat_bookings')
      .upsert(
        rows.map(r => ({
          charter_number: r.charterNumber,
          listing_title: r.listingTitle,
          charter_start_date: r.startDate,
          charter_end_date: r.endDate,
          duration_days: r.durationDays,
          gross_amount_cents: r.grossAmountCents,
          net_amount_cents: r.netAmountCents,
          bank_transfer_date: r.bankTransferDate,
          location: r.location,
          raw_filename: file.name,
        })),
        { onConflict: 'charter_number' }
      )
      .select('id')
    if (error) return apiError(error.message)

    return apiOk({
      rowCount: rows.length,
      storedCount: upserted?.length ?? 0,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
