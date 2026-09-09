import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { syncAllCruisesAvailability } from '@/lib/fareharbor/sync-availability'
import { alertCronFailure } from '@/lib/cron/alert'

/**
 * GET /api/cron/availability-sync
 * Vercel Cron: runs 3x daily (05:00, 11:00, 17:00 UTC = 07:00, 13:00, 19:00 Amsterdam time).
 *
 * Fetches FareHarbor availabilities for the 2 base items (Private & Shared) for the next
 * 14 days (4 API calls total), projects availability per virtual listing according to its
 * filters (cutoffs, boat assignments, hours), saves precomputed snapshots to Supabase,
 * and revalidates Next.js public cruise pages across all 7 locales.
 */
export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request)
  if (denied) return denied

  try {
    const result = await syncAllCruisesAvailability(14)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/availability-sync] Error:', err)
    await alertCronFailure('availability-sync', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

// Support manual POST triggering from admin or internal tools
export const POST = GET
