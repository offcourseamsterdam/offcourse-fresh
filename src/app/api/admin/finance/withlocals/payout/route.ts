import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdminOrFinanceShare } from '@/lib/auth/finance-share'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseWithlocalsPayoutText } from '@/lib/finance/withlocals-payout'

// Not a file upload, but the text still goes through regex parsing — cap it
// well above any real payout email (even a very busy month's worth of lines)
// as a cheap defense-in-depth guard rather than trusting an unbounded body.
const MAX_EMAIL_TEXT_LENGTH = 20_000

/**
 * POST /api/admin/finance/withlocals/payout
 *
 * Save a Withlocals "New payout" email — no attachment, so the caller sends
 * the email's visible text and a payoutDate (when the money was queued, e.g.
 * the email's date, first-of-month). Each line only has an 8-char booking id
 * (the invoice's full-UUID prefix), so this matches against any existing row
 * by that prefix; a booking not yet invoiced gets a stub row so the payout is
 * never lost even if the invoice email hasn't been processed yet.
 *
 * Safe to re-run: matching lines just update payout_date/guest again.
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

    const payout = parseWithlocalsPayoutText(body.emailText)
    if (payout.lines.length === 0) return apiError('Could not find any booking lines in this payout email', 400)

    const supabase = createAdminClient()

    let newStubs = 0
    let updated = 0
    for (const line of payout.lines) {
      if (!line.bookingId) continue

      const { data: existing, error: lookupError } = await supabase
        .from('withlocals_bookings')
        .select('id, booking_id')
        .or(`booking_id.eq.${line.bookingId},booking_id.like.${line.bookingId}%`)
        .maybeSingle()
      // .maybeSingle() errors if the prefix ever matches more than one row —
      // e.g. two unrelated bookings sharing an 8-char id prefix. Surface that
      // loudly rather than silently treating it as "not found" and inserting
      // a duplicate stub that would double-count revenue.
      if (lookupError) return apiError(`${lookupError.message} (booking ${line.bookingId})`)

      if (existing) {
        // net_payout_cents is set here too — it should already agree with the
        // invoice's figure (same payout), so this is a harmless re-confirm,
        // not an overwrite risk.
        const { error } = await supabase
          .from('withlocals_bookings')
          .update({
            payout_date: body.payoutDate,
            guest_name: line.guest,
            net_payout_cents: line.amountCents,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id)
        if (error) return apiError(error.message)
        updated++
      } else {
        const { error } = await supabase.from('withlocals_bookings').insert({
          booking_id: line.bookingId,
          guest_name: line.guest,
          net_payout_cents: line.amountCents,
          payout_date: body.payoutDate,
        })
        if (error) return apiError(error.message)
        newStubs++
      }
    }

    const balanced = payout.linesTotalCents === payout.totalCents
    return apiOk({
      payoutDate: body.payoutDate,
      totalCents: payout.totalCents,
      lineCount: payout.lines.length,
      newStubs,
      updated,
      balanced,
    })
  } catch (e) {
    return apiError(e instanceof Error ? e.message : 'Unexpected server error', 500)
  }
}
