import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseGetMyBoatPayoutText } from '@/lib/finance/getmyboat-payout'

// Not a file upload — the caller sends the payout email's visible text,
// which still goes through regex parsing. Capped well above any real
// payout email as a cheap defense-in-depth guard, same as Withlocals' payout route.
const MAX_EMAIL_TEXT_LENGTH = 20_000

/**
 * POST /api/admin/finance/getmyboat/payout
 *
 * Save a Getmyboat "Getmyboat has sent you money" email — no attachment, so
 * the caller sends the email's visible text and a payoutDate (the email's
 * own send date). Each line carries the exact same numeric booking id used
 * everywhere else (the "Booking Confirmed!" email, the transactions portal),
 * so this upserts by an exact match — no fuzzy prefix matching needed,
 * unlike Withlocals.
 *
 * There is deliberately no UI form for this — an agent posts the email text
 * directly in the background, same reasoning as Withlocals' payout route.
 *
 * Safe to re-run: matching bookings just update guest/net/payout_date again.
 *
 * Body (JSON): { payoutDate: "YYYY-MM-DD", emailText: "<the payout email body>" }
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminOrFinanceShare()
  if (denied) return denied
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body.emailText !== 'string') return apiError('emailText is required', 400)
    if (body.emailText.length > MAX_EMAIL_TEXT_LENGTH) return apiError('emailText too long', 400)
    if (typeof body.payoutDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.payoutDate)) {
      return apiError('payoutDate must be "YYYY-MM-DD"', 400)
    }

    const payout = parseGetMyBoatPayoutText(body.emailText)
    if (payout.lines.length === 0) return apiError('Could not find any booking lines in this payout email', 400)

    const supabase = createAdminClient()

    const { data: upserted, error } = await supabase
      .from('getmyboat_bookings')
      .upsert(
        payout.lines.map(line => ({
          booking_id: line.bookingId,
          guest_name: line.guest,
          charter_date: line.charterDate,
          net_amount_cents: line.amountCents,
          payout_date: body.payoutDate,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'booking_id' }
      )
      .select('id')
    if (error) return apiError(error.message)

    const balanced = payout.linesTotalCents === payout.totalCents
    return apiOk({
      payoutDate: body.payoutDate,
      totalCents: payout.totalCents,
      lineCount: payout.lines.length,
      storedCount: upserted?.length ?? 0,
      balanced,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
