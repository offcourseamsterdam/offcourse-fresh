import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { draftCateringOrders, draftTomorrowSchedule } from '@/lib/ghost/ops-drafters'
import { alertCronFailure } from '@/lib/cron/alert'

/**
 * Ghost ops cron — daily at 15:00 UTC (17:00 Amsterdam in summer).
 * The Ghost shadow-drafts tomorrow's captain schedule and the upcoming
 * catering order. Both are status 'shadow': logged on /admin/ghost,
 * never executed, deduped per target date (a re-run is a no-op).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req)
  if (denied) return denied

  try {
    const [schedule, catering] = await Promise.all([
      draftTomorrowSchedule(),
      draftCateringOrders(),
    ])

    return NextResponse.json({ schedule, catering })
  } catch (err) {
    // The drafters swallow their own per-item errors, but anything thrown at the
    // route level (e.g. a Supabase/Anthropic outage) would otherwise vanish.
    await alertCronFailure('ghost-ops', err)
    return NextResponse.json({ error: 'Ghost ops failed' }, { status: 500 })
  }
}
