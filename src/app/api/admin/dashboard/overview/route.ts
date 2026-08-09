import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { amsterdamToday } from '@/lib/utils'
import { GHOST_AGENTS, agentAutonomy } from '@/lib/ghost/agents'
import { getNextAvailabilityRequestDate } from '@/lib/scheduling/availability-request'
import { getNextScheduleDigestAt } from '@/lib/scheduling/schedule-digest'

// Same convention as generate-shifts.ts's ACTIVE_STATUSES — a booking that
// hasn't actually paid/confirmed isn't a real departure yet.
const ACTIVE_BOOKING_STATUSES = ['booked', 'confirmed']

const AUTONOMY_LABEL: Record<string, string> = {
  propose: 'shadow',
  dry_run: 'dry-run',
  ask: 'ask first',
  auto: 'auto',
}

const KNOWN_GAPS = [
  "Catering order cards in the Ghost review queue are read-only — there's no action button to confirm or send from there yet.",
  'Four separate "confirm to send" buttons (maintenance, stock, catering upsell, guest move) are near-identical copies instead of one shared component.',
  'A second automation plan (consolidating booking-ops timeline events) was written but never executed.',
]

/**
 * GET /api/admin/dashboard/overview — the admin home page's real data,
 * replacing the placeholder "—" KPI cards that shipped with the original
 * dashboard stub. Four zones: today's business pulse, the captain schedule,
 * AI activity (recent + upcoming), and honest build-progress/gaps for the
 * agent system itself — see docs/features/admin-dashboard.md.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const supabase = createAdminClient()
    const today = amsterdamToday()
    const weekEnd = amsterdamToday(6)
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [bookingsTodayRes, bookingsWeekRes, reconciliationRes, shiftsWeekRes, stockRes, openChatsRes, awaitingReviewRes] =
      await Promise.all([
        supabase
          .from('bookings')
          .select('id, guest_count, stripe_amount', { count: 'exact' })
          .eq('booking_date', today)
          .in('status', ACTIVE_BOOKING_STATUSES),
        supabase
          .from('bookings')
          .select('id, stripe_amount', { count: 'exact' })
          .gte('booking_date', today)
          .lte('booking_date', weekEnd)
          .in('status', ACTIVE_BOOKING_STATUSES),
        supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('payment_status', 'needs_reconciliation'),
        supabase
          .from('shifts')
          .select('id, date, start_at, end_at, status, staff(name), boats(name)')
          .gte('date', today)
          .lte('date', weekEnd)
          .neq('status', 'cancelled')
          .order('start_at', { ascending: true }),
        supabase
          .from('stock_items')
          .select('id, name, current_count, reorder_threshold')
          .eq('active', true)
          .order('current_count', { ascending: true }),
        supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('status', 'open'),
        supabase
          .from('agent_proposals')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'shadow')
          .gte('created_at', since24),
      ])

    for (const res of [bookingsTodayRes, bookingsWeekRes, reconciliationRes, shiftsWeekRes, stockRes, openChatsRes, awaitingReviewRes]) {
      if (res.error) return apiError(res.error.message)
    }

    const revenueThisWeekCents = (bookingsWeekRes.data ?? []).reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0)
    const lowStock = (stockRes.data ?? []).filter(s => (s.current_count ?? 0) <= (s.reorder_threshold ?? 0))

    const shifts = shiftsWeekRes.data ?? []
    const shiftsToday = shifts.filter(s => s.date === today)
    const byCaptain = new Map<string, number>()
    for (const s of shifts) {
      const name = s.staff?.name ?? null
      if (!name) continue
      byCaptain.set(name, (byCaptain.get(name) ?? 0) + 1)
    }

    const agentProgress = GHOST_AGENTS.map(a => ({
      key: a.key,
      name: a.name,
      autonomy: AUTONOMY_LABEL[agentAutonomy(a)] ?? agentAutonomy(a),
    }))

    return apiOk({
      business: {
        cruisesToday: bookingsTodayRes.count ?? 0,
        cruisesThisWeek: bookingsWeekRes.count ?? 0,
        revenueThisWeekCents,
        needsReconciliationCount: reconciliationRes.count ?? 0,
        lowStock: lowStock.map(s => ({ name: s.name, currentCount: s.current_count, reorderThreshold: s.reorder_threshold })),
      },
      captains: {
        today: shiftsToday.map(s => ({
          id: s.id,
          startAt: s.start_at,
          endAt: s.end_at,
          staffName: s.staff?.name ?? null,
          boatName: s.boats?.name ?? null,
          status: s.status,
        })),
        thisWeekByCaptain: [...byCaptain.entries()].map(([staffName, shiftCount]) => ({ staffName, shiftCount })),
        openShiftsThisWeek: shifts.filter(s => s.status === 'open').length,
      },
      aiActivity: {
        openChatsCount: openChatsRes.count ?? 0,
        awaitingReviewCount: awaitingReviewRes.count ?? 0,
        nextScheduleDigestAt: getNextScheduleDigestAt(),
        nextAvailabilityRequest: getNextAvailabilityRequestDate(),
      },
      agentProgress,
      knownGaps: KNOWN_GAPS,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to load dashboard overview')
  }
}
