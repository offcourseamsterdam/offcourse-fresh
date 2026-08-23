import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeDayFacts, type OpsReviewShift } from '@/lib/ghost/ops-review'
import {
  findCrossDayConsolidationCandidates,
  type ConsolidationShift,
  type ConsolidationBooking,
} from '@/lib/ghost/cross-day-consolidation'
import { draftCrossDayConsolidation } from '@/lib/ghost/cross-day-move-drafter'
import type { ExtrasLineItem } from '@/lib/catering/filter'

/**
 * GET /api/admin/planning/optimizer?from=&to= — every schedule inefficiency
 * the Optimizer panel can find for the given date range, all three kinds:
 * same-day paid gaps and same-day cross-boat merges (ops-review.ts's
 * existing, already-correct computeDayFacts — just never run on demand
 * across a range before, only once nightly for tomorrow), plus the new
 * cross-day consolidation. See
 * docs/plans/2026-08-23-cross-day-consolidation-optimizer.md.
 *
 * Cross-day items are eagerly drafted (Claude writes the SMS/email) so the
 * panel can show the exact message without a second round-trip per row —
 * idempotent: a candidate whose booking already has an open drafted ask
 * reuses it instead of drafting (and calling Claude) again.
 */

type AdminClient = ReturnType<typeof createAdminClient>

const SHIFT_SELECT =
  'id, date, start_at, end_at, status, staff_id, booking_id, fareharbor_availability_pk, boat_id, staff(name, hourly_rate_cents), boats(name, max_capacity)'
const BOOKING_SELECT =
  'id, booking_date, category, customer_name, customer_email, customer_phone, extras_selected, listing_title, guest_count, receipt_total, base_amount_cents, extras_amount_cents, fareharbor_availability_pk, customer_type_name, start_time, end_time'

interface RawStaff {
  name?: string
  hourly_rate_cents?: number
}
interface RawBoat {
  name?: string
  max_capacity?: number | null
}
interface RawShiftRow {
  id: string
  date: string
  start_at: string
  end_at: string
  status: string
  staff_id: string | null
  booking_id: string | null
  fareharbor_availability_pk: number | null
  boat_id: string | null
  staff: RawStaff | null
  boats: RawBoat | null
}
interface RawBookingRow {
  id: string
  booking_date: string | null
  category: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  extras_selected: unknown
  listing_title: string | null
  guest_count: number | null
  receipt_total: number | null
  base_amount_cents: number | null
  extras_amount_cents: number | null
  fareharbor_availability_pk: number | null
  customer_type_name: string | null
  start_time: string | null
  end_time: string | null
}

function toConsolidationBooking(b: RawBookingRow): ConsolidationBooking {
  return {
    id: b.id,
    category: b.category,
    customerTypeName: b.customer_type_name,
    customerName: b.customer_name,
    customerEmail: b.customer_email,
    customerPhone: b.customer_phone,
    guestCount: b.guest_count,
    totalCents: b.receipt_total ?? (b.base_amount_cents ?? 0) + (b.extras_amount_cents ?? 0),
    fareharborAvailabilityPk: b.fareharbor_availability_pk,
    extrasSelected: (b.extras_selected as ExtrasLineItem[] | null) ?? null,
    listingTitle: b.listing_title,
    startTime: b.start_time,
    endTime: b.end_time,
  }
}

/** Every booking a shift covers — by its primary booking_id, or (shared) every
 *  booking sharing its fareharbor_availability_pk. Same resolution technique
 *  guest-move-drafter.ts's resolveSingleBooking already uses; this just
 *  returns the whole matched list instead of only when there's exactly one. */
function bookingsForShift(
  shift: RawShiftRow,
  bookingsById: Map<string, RawBookingRow>,
  bookingsByAvailPk: Map<number, RawBookingRow[]>,
): RawBookingRow[] {
  if (shift.booking_id) {
    const b = bookingsById.get(shift.booking_id)
    return b ? [b] : []
  }
  if (shift.fareharbor_availability_pk != null) {
    return bookingsByAvailPk.get(shift.fareharbor_availability_pk) ?? []
  }
  return []
}

async function findOpenCrossDayProposal(supabase: AdminClient, bookingId: string) {
  const { data } = await supabase
    .from('agent_proposals')
    .select('id, payload')
    .eq('kind', 'guest_move_request')
    .eq('payload->>booking_id', bookingId)
    .eq('payload->>move_type', 'cross_day')
    .in('status', ['shadow', 'sending', 'approved'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { id: string; payload: Record<string, unknown> } | null
}

export interface OptimizerItem {
  kind: 'same_day_gap' | 'same_day_merge' | 'cross_day_consolidation'
  date: string
  boat: string
  summary: string
  /** null only when a same-day item's captain is unassigned — a real
   *  candidate still worth showing, just unpriceable. Cross-day items are
   *  always priced (0 when unassigned, per findCrossDayConsolidationCandidates). */
  estSavingCents: number | null
  proposalId?: string
  guestName?: string | null
  smsText?: string
  emailSubject?: string
  emailBody?: string
  toDate?: string
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { searchParams } = new URL(request.url)
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return apiError('from and to (YYYY-MM-DD) are required', 400)
    }

    const supabase = createAdminClient()
    const [shiftsRes, bookingsRes] = await Promise.all([
      supabase
        .from('shifts')
        .select(SHIFT_SELECT)
        .gte('date', from)
        .lte('date', to)
        .in('status', ['open', 'assigned', 'confirmed'])
        .order('start_at'),
      supabase
        .from('bookings')
        .select(BOOKING_SELECT)
        .gte('booking_date', from)
        .lte('booking_date', to)
        .in('status', ['confirmed', 'booked']),
    ])
    if (shiftsRes.error) return apiError(shiftsRes.error.message)
    if (bookingsRes.error) return apiError(bookingsRes.error.message)

    const rawShifts = (shiftsRes.data ?? []) as unknown as RawShiftRow[]
    const rawBookings = (bookingsRes.data ?? []) as unknown as RawBookingRow[]

    const bookingsById = new Map(rawBookings.map(b => [b.id, b]))
    const bookingsByAvailPk = new Map<number, RawBookingRow[]>()
    for (const b of rawBookings) {
      if (b.fareharbor_availability_pk == null) continue
      const list = bookingsByAvailPk.get(b.fareharbor_availability_pk) ?? []
      list.push(b)
      bookingsByAvailPk.set(b.fareharbor_availability_pk, list)
    }

    const items: OptimizerItem[] = []

    // ── Same-day facts (existing, already-correct logic — just run per
    // visible day instead of only ever for tomorrow via the nightly cron). ──
    const shiftsByDate = new Map<string, RawShiftRow[]>()
    for (const s of rawShifts) {
      const list = shiftsByDate.get(s.date) ?? []
      list.push(s)
      shiftsByDate.set(s.date, list)
    }
    for (const [date, dayShifts] of shiftsByDate) {
      const opsShifts: OpsReviewShift[] = dayShifts.map(s => {
        const matched = bookingsForShift(s, bookingsById, bookingsByAvailPk)
        // computeDayFacts (like the rest of ops-review.ts) reasons about ONE
        // booking per shift — a multi-party shared departure's guest count
        // here is only its first booking's, same simplification the nightly
        // ops review already lives with. Not fixed here; out of scope.
        const rep = matched[0] ?? null
        return {
          id: s.id,
          boat: s.boats?.name ?? '?',
          boatCapacity: s.boats?.max_capacity ?? null,
          startAt: s.start_at,
          endAt: s.end_at,
          status: s.status,
          staffId: s.staff_id,
          staffName: s.staff?.name ?? null,
          hourlyRateCents: s.staff?.hourly_rate_cents ?? null,
          category: rep?.category ?? null,
          guestCount: rep?.guest_count ?? null,
          listingTitle: rep?.listing_title ?? null,
        }
      })
      const facts = computeDayFacts(date, opsShifts, [], [])
      for (const gap of facts.gaps) {
        items.push({
          kind: 'same_day_gap',
          date,
          boat: gap.boat,
          summary: `${gap.boat}: ${gap.minutes} min idle ${gap.fromTime}–${gap.toTime}`,
          estSavingCents: gap.estIdleCostCents,
        })
      }
      for (const merge of facts.mergeCandidates) {
        items.push({
          kind: 'same_day_merge',
          date,
          boat: merge.fromBoat,
          summary: `${merge.cruise ?? 'Departure'} (${merge.guests ?? '?'} guests) could move ${merge.fromBoat} → ${merge.toBoat}`,
          estSavingCents: null,
        })
      }
    }

    // ── Cross-day consolidation (new). ──
    const consolidationShifts: ConsolidationShift[] = rawShifts.map(s => ({
      shiftId: s.id,
      boat: s.boats?.name ?? '?',
      date: s.date,
      startAt: s.start_at,
      endAt: s.end_at,
      hourlyRateCents: s.staff?.hourly_rate_cents ?? null,
      bookings: bookingsForShift(s, bookingsById, bookingsByAvailPk).map(toConsolidationBooking),
    }))
    const boatCapacityByBoat: Record<string, number | null> = {}
    for (const s of rawShifts) {
      if (s.boats?.name) boatCapacityByBoat[s.boats.name] = s.boats.max_capacity ?? null
    }
    const candidates = findCrossDayConsolidationCandidates(consolidationShifts, boatCapacityByBoat)

    const crossDayItems = await Promise.all(
      candidates.map(async (c): Promise<OptimizerItem> => {
        const existing = await findOpenCrossDayProposal(supabase, c.booking.id)
        const drafted =
          existing ??
          (await (async () => {
            const outcome = await draftCrossDayConsolidation(supabase, c, { source: 'admin/planning/optimizer' })
            return outcome === 'drafted' ? await findOpenCrossDayProposal(supabase, c.booking.id) : null
          })())

        const payload = (drafted?.payload ?? {}) as { sms_text?: string; email_subject?: string; email_body?: string }
        return {
          kind: 'cross_day_consolidation',
          date: c.fromDate,
          boat: c.boat,
          summary: `${c.booking.customerName ?? 'Guest'} (${c.booking.guestCount ?? '?'} guests, ${c.fromDate}) could join ${c.toDate}'s ${c.boat} departure (${c.receivingBooking.guestCount ?? '?'} already booked, ${c.capacity - c.combinedGuestCount} spots would remain) — frees the whole ${c.fromDate} shift.`,
          estSavingCents: c.estSavingCents,
          proposalId: drafted?.id,
          guestName: c.booking.customerName,
          smsText: payload.sms_text,
          emailSubject: payload.email_subject,
          emailBody: payload.email_body,
          toDate: c.toDate,
        }
      }),
    )
    items.push(...crossDayItems)

    return apiOk({ items })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
