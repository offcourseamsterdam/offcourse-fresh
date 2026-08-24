import { NextRequest, NextResponse } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireCaptain } from '@/lib/auth/require-captain'
import { createAdminClient } from '@/lib/supabase/admin'
import { monthRange } from '@/lib/scheduling/availability-status'
import { entryMinutes, payForMinutes } from '@/lib/scheduling/payroll'

/**
 * GET /api/captain/finance?month=YYYY-MM — a captain's own numbers for one
 * month (Beer, 2026-08-24: "a finance tab where captains can see per month
 * how much they have cruised; also how many reviews they have assigned to
 * their name and also extra hours sold bonus"). Own staff_id only, scoped
 * server-side — same trust boundary as /api/captain/availability.
 *
 * Reuses the exact same tables and math as the admin Payroll tab
 * (time_entries + review_bonuses + extra_hours_bonuses) so a captain's own
 * view can never show a different number than what they're actually paid.
 *
 * reviewsAssigned counts EVERY review_bonuses row in the month, including
 * ones with excluded_from_payroll=true (the 2026-08-22/23 backfill scan) —
 * that flag means "don't pay this bonus out", not "this review wasn't
 * really theirs". reviewBonusCents (the money) DOES apply that filter, so
 * it always matches what payroll actually pays — a captain can see "12
 * reviews" and "€0 bonus this month" at once, honestly, rather than the
 * backfill silently erasing the recognition count too.
 */
export async function GET(request: NextRequest) {
  const auth = await requireCaptain()
  if (auth instanceof NextResponse) return auth

  try {
    const month = new URL(request.url).searchParams.get('month')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) return apiError('month (YYYY-MM) is required', 400)
    const { from, to } = monthRange(month)

    const supabase = createAdminClient()
    const [entriesRes, reviewBonusesRes, extraHoursRes] = await Promise.all([
      supabase
        .from('time_entries')
        .select('clock_in_at, clock_out_at, hourly_rate_cents')
        .eq('staff_id', auth.staff.id)
        .gte('clock_in_at', `${from}T00:00:00.000Z`)
        .lte('clock_in_at', `${to}T23:59:59.999Z`),
      supabase
        .from('review_bonuses')
        .select('amount_cents, excluded_from_payroll')
        .eq('staff_id', auth.staff.id)
        .gte('awarded_at', `${from}T00:00:00.000Z`)
        .lte('awarded_at', `${to}T23:59:59.999Z`),
      supabase
        .from('extra_hours_bonuses')
        .select('date, extra_minutes, amount_charged_cents, commission_cents, note')
        .eq('staff_id', auth.staff.id)
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true }),
    ])
    if (entriesRes.error) return apiError(entriesRes.error.message)
    if (reviewBonusesRes.error) return apiError(reviewBonusesRes.error.message)
    if (extraHoursRes.error) return apiError(extraHoursRes.error.message)

    let cruisedMinutes = 0
    let basePayCents = 0
    for (const e of entriesRes.data ?? []) {
      const minutes = entryMinutes(e)
      if (minutes === null) continue // still clocked in — not paid yet
      cruisedMinutes += minutes
      basePayCents += payForMinutes(minutes, e.hourly_rate_cents)
    }

    const reviewRows = reviewBonusesRes.data ?? []
    const reviewsAssigned = reviewRows.length
    const reviewBonusCents = reviewRows.filter(r => !r.excluded_from_payroll).reduce((sum, r) => sum + r.amount_cents, 0)

    const extraHoursEntries = extraHoursRes.data ?? []
    const extraHoursBonusCents = extraHoursEntries.reduce((sum, x) => sum + x.commission_cents, 0)

    return apiOk({
      month,
      cruisedMinutes,
      basePayCents,
      reviewsAssigned,
      reviewBonusCents,
      extraHoursBonusCents,
      extraHoursEntries,
      totalCents: basePayCents + reviewBonusCents + extraHoursBonusCents,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
