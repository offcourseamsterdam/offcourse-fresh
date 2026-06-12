import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { draftCateringOrders, draftTomorrowSchedule } from '@/lib/ghost/ops-drafters'

/**
 * Ghost ops cron — daily at 15:00 UTC (17:00 Amsterdam in summer).
 * The Ghost shadow-drafts tomorrow's captain schedule and the upcoming
 * catering order. Both are status 'shadow': logged on /admin/ghost,
 * never executed, deduped per target date (a re-run is a no-op).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req)
  if (denied) return denied

  const [schedule, catering] = await Promise.all([
    draftTomorrowSchedule(),
    draftCateringOrders(),
  ])

  return NextResponse.json({ schedule, catering })
}
