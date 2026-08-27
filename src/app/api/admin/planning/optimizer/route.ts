import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeDayFacts, type OpsReviewShift, type MergeCandidate } from '@/lib/ghost/ops-review'
import {
  findCrossDayConsolidationCandidates,
  type ConsolidationShift,
  type ConsolidationBooking,
} from '@/lib/ghost/cross-day-consolidation'
import { draftCrossDayConsolidation } from '@/lib/ghost/cross-day-move-drafter'
import { validateBoatSwap, draftBoatSwap, type BoatSwapBooking } from '@/lib/ghost/boat-swap-drafter'
import { openMoveRequestExists } from '@/lib/ghost/guest-move-drafter'
import { OPTIMIZE_HORIZON_DAYS, hasEnoughNotice } from '@/lib/ghost/rulebook'
import { emitOpsEvent } from '@/lib/ops/events'
import { deriveOptimizerState, type OptimizerDisplayState, type ProposalOutcome } from '@/lib/scheduling/optimizer-status'
import { amsterdamToday } from '@/lib/utils'
import type { ExtrasLineItem } from '@/lib/catering/filter'

/**
 * GET /api/admin/planning/optimizer — every schedule inefficiency the
 * Optimizer panel can find, all three kinds: same-day paid gaps and
 * same-day cross-boat merges (ops-review.ts's existing, already-correct
 * computeDayFacts — just never run on demand before, only once nightly for
 * tomorrow), plus cross-day consolidation. See
 * docs/plans/2026-08-23-cross-day-consolidation-optimizer.md.
 *
 * The scan range is ALWAYS today → today + OPTIMIZE_HORIZON_DAYS, computed
 * server-side — deliberately NOT a caller-supplied range (Beer, 2026-08-23:
 * "always from the point of view of today, not the past week"). Optimizing
 * a day that already happened is meaningless, and the Planning page can be
 * scrolled to any week — this route must never inherit that as its scan
 * window, or it starts reporting on cruises that have already sailed.
 *
 * Cross-day items are eagerly drafted (Claude writes the SMS/email) so the
 * panel can show the exact message without a second round-trip per row —
 * idempotent: a candidate whose booking already has an open drafted ask
 * reuses it instead of drafting (and calling Claude) again.
 *
 * Same-day findings are persisted too (Beer, 2026-08-23: "whatever it
 * finds, it should store that information") — otherwise a gap or merge
 * opportunity is recomputed and silently discarded every time the panel
 * closes, with no record it was ever seen. Recorded as a `recommendation_
 * created` ops_event (actorType 'system', not 'agent' — no AI judgment is
 * involved here, it's plain math, same distinction the Ops Center draws
 * between AI-judgment and zero-judgment automated findings), deduped per
 * (date, boat, finding kind) so re-opening the panel doesn't re-log the
 * same still-true finding on every request.
 */

type AdminClient = ReturnType<typeof createAdminClient>

const SHIFT_SELECT =
  'id, date, start_at, end_at, status, staff_id, booking_id, fareharbor_availability_pk, boat_id, staff(name, hourly_rate_cents), boats(name, max_capacity), shift_bookings(booking_id)'
const BOOKING_SELECT =
  'id, booking_date, category, customer_name, customer_email, customer_phone, extras_selected, listing_id, listing_title, guest_count, receipt_total, base_amount_cents, extras_amount_cents, fareharbor_availability_pk, customer_type_name, start_time, end_time, no_reschedule_ask'

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
  shift_bookings: { booking_id: string }[] | null
}
interface RawBookingRow {
  id: string
  booking_date: string | null
  category: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  extras_selected: unknown
  listing_id: string | null
  listing_title: string | null
  guest_count: number | null
  receipt_total: number | null
  base_amount_cents: number | null
  extras_amount_cents: number | null
  fareharbor_availability_pk: number | null
  customer_type_name: string | null
  start_time: string | null
  end_time: string | null
  no_reschedule_ask: boolean | null
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
    noRescheduleAsk: b.no_reschedule_ask ?? false,
  }
}

function toBoatSwapBooking(b: RawBookingRow): BoatSwapBooking {
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
    listingId: b.listing_id,
    listingTitle: b.listing_title,
    startTime: b.start_time,
    endTime: b.end_time,
  }
}

/**
 * Every booking a shift covers. Prefers `shift_bookings` — the REAL
 * membership (127_shift_bookings.sql, whose own index comment names this
 * exact lookup) — because `booking_id`/`fareharbor_availability_pk` are only
 * the shift's PRIMARY departure, not its full membership. That distinction
 * is not academic: a real live bug here (2026-08-23) was a Wednesday
 * Curaçao shift covering BOTH a private cruise (its primary booking_id) AND
 * an unrelated shared cruise — the old booking_id/availability_pk-only
 * resolution saw only the private booking and never even noticed the shared
 * one existed, so a real multi-departure day silently looked like a clean
 * single-departure one.
 *
 * Falls back to the booking_id/availability_pk heuristic (same technique
 * guest-move-drafter.ts's resolveSingleBooking already uses) only for rows
 * predating the shift_bookings backfill, where membership is empty.
 */
function bookingsForShift(
  shift: RawShiftRow,
  bookingsById: Map<string, RawBookingRow>,
  bookingsByAvailPk: Map<number, RawBookingRow[]>,
): RawBookingRow[] {
  if (shift.shift_bookings?.length) {
    return shift.shift_bookings
      .map(m => bookingsById.get(m.booking_id))
      .filter((b): b is RawBookingRow => !!b)
  }
  if (shift.booking_id) {
    const b = bookingsById.get(shift.booking_id)
    return b ? [b] : []
  }
  if (shift.fareharbor_availability_pk != null) {
    return bookingsByAvailPk.get(shift.fareharbor_availability_pk) ?? []
  }
  return []
}

/** Has this exact (date, boat, finding kind) already been recorded? Ever —
 *  not time-windowed. A still-true finding re-appearing on every scan isn't
 *  new information; only a genuinely fresh finding_type/date/boat triple is. */
async function sameDayFindingAlreadyRecorded(
  supabase: AdminClient,
  date: string,
  boat: string,
  findingType: 'same_day_gap' | 'same_day_merge',
): Promise<boolean> {
  const { data } = await supabase
    .from('ops_events')
    .select('id')
    .eq('event_type', 'recommendation_created')
    .eq('source', 'admin/planning/optimizer')
    .eq('payload->>date', date)
    .eq('payload->>boat', boat)
    .eq('payload->>finding_type', findingType)
    .limit(1)
    .maybeSingle()
  return !!data
}

async function recordSameDayFinding(supabase: AdminClient, item: OptimizerItem): Promise<void> {
  if (item.kind !== 'same_day_gap' && item.kind !== 'same_day_merge') return
  if (await sameDayFindingAlreadyRecorded(supabase, item.date, item.boat, item.kind)) return
  await emitOpsEvent({
    eventType: 'recommendation_created',
    actorType: 'system',
    source: 'admin/planning/optimizer',
    payload: {
      finding_type: item.kind,
      date: item.date,
      boat: item.boat,
      est_saving_cents: item.estSavingCents,
      summary: item.summary,
    },
  })
}

/** Statuses that mean "this ask is still live" — an open proposal blocks
 *  re-drafting the same move, and is what the panel can still act on. */
const OPEN_PROPOSAL_STATUSES = ['shadow', 'sending', 'approved']

/** Everything above plus the terminal states. The Planning overlay shows the
 *  full lifecycle (Beer, 2026-08-27: every status distinctly), so a finished
 *  or declined move still has to come back from this route — but only the
 *  OPEN ones may suppress a fresh draft, hence the two separate lookups. */
const ALL_PROPOSAL_STATUSES = [...OPEN_PROPOSAL_STATUSES, 'proposed', 'booking', 'confirming', 'executed', 'rejected', 'expired', 'skipped']

type ProposalRow = {
  id: string
  payload: Record<string, unknown>
  status: string
  outcome: Record<string, unknown> | null
}

async function findProposal(
  supabase: AdminClient,
  bookingId: string,
  moveType: 'cross_day' | 'boat_swap',
  statuses: string[],
) {
  const { data } = await supabase
    .from('agent_proposals')
    .select('id, payload, status, outcome')
    .eq('kind', 'guest_move_request')
    .eq('payload->>booking_id', bookingId)
    .eq('payload->>move_type', moveType)
    .in('status', statuses)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as ProposalRow | null
}

const findOpenCrossDayProposal = (supabase: AdminClient, bookingId: string) =>
  findProposal(supabase, bookingId, 'cross_day', OPEN_PROPOSAL_STATUSES)

const findOpenBoatSwapProposal = (supabase: AdminClient, bookingId: string) =>
  findProposal(supabase, bookingId, 'boat_swap', OPEN_PROPOSAL_STATUSES)

/** Any proposal for this booking regardless of lifecycle stage — used only to
 *  decorate a finding with its real state for the overlay. */
const findAnyCrossDayProposal = (supabase: AdminClient, bookingId: string) =>
  findProposal(supabase, bookingId, 'cross_day', ALL_PROPOSAL_STATUSES)

const findAnyBoatSwapProposal = (supabase: AdminClient, bookingId: string) =>
  findProposal(supabase, bookingId, 'boat_swap', ALL_PROPOSAL_STATUSES)

/** Folds a proposal row's id, drafted copy and derived lifecycle state onto a
 *  finding. Kept in one place so cross-day and boat-swap items can never drift
 *  apart in what the overlay receives. */
function withProposal(base: OptimizerItem, row: ProposalRow | null, guestName: string | null | undefined): OptimizerItem {
  if (!row) return base
  const payload = (row.payload ?? {}) as { sms_text?: string; email_subject?: string; email_body?: string }
  return {
    ...base,
    proposalId: row.id,
    guestName: guestName ?? base.guestName,
    smsText: payload.sms_text,
    emailSubject: payload.email_subject,
    emailBody: payload.email_body,
    state: deriveOptimizerState(row.status, (row.outcome ?? null) as ProposalOutcome | null),
  }
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

  // ── Overlay fields (Beer, 2026-08-27) ──────────────────────────────────
  // The Planning grid overlay draws each finding in place, so it needs both
  // the proposal's real lifecycle state and enough identity to anchor a
  // marker to the right chip/lane. All optional: `same_day_gap` findings
  // have no proposal and no booking behind them at all.

  /** Display state derived from agent_proposals.status + outcome — see
   *  src/lib/scheduling/optimizer-status.ts. Absent when there's no proposal. */
  state?: OptimizerDisplayState
  /** The booking this move would relocate — the overlay's anchor for the
   *  origin marker (matched against the grid's own departure chips). */
  bookingId?: string
  /** Boat the move would land on. Same-day swaps only; the overlay draws the
   *  connector from `boat` to this lane within the same day row. */
  toBoat?: string
  /** Start of the idle span a `same_day_gap` covers, for the ghost outline. */
  gapStartAt?: string
  gapEndAt?: string
}

export async function GET(_request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    // Deliberately not read from the query string — see the file doc comment.
    const from = amsterdamToday()
    const to = amsterdamToday(OPTIMIZE_HORIZON_DAYS)

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
    const allMergeCandidates: MergeCandidate[] = []
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
          noRescheduleAsk: rep?.no_reschedule_ask ?? false,
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
          // The overlay draws a ghost outline across exactly this span.
          gapStartAt: gap.fromAt,
          gapEndAt: gap.toAt,
        })
      }
      allMergeCandidates.push(...facts.mergeCandidates)
    }

    // ── Boat swap (new). ── Each merge candidate is dry-run validated against
    // FareHarbor (same time, other boat) and, when bookable, drafted as an
    // actual ask — same eager-draft-with-idempotency-check shape as cross-day
    // below. A candidate that can't be resolved to a contactable booking, or
    // has no real slot to swap onto, still surfaces as a read-only finding
    // (unchanged from before) rather than being dropped.
    const boatSwapItems = await Promise.all(
      allMergeCandidates.map(async (merge): Promise<OptimizerItem> => {
        const base: OptimizerItem = {
          kind: 'same_day_merge',
          date: merge.date,
          boat: merge.fromBoat,
          summary: `${merge.cruise ?? 'Departure'} (${merge.guests ?? '?'} guests) could move ${merge.fromBoat} → ${merge.toBoat} — frees ${merge.fromBoat}'s captain for the day.`,
          estSavingCents: merge.estSavingCents,
          toBoat: merge.toBoat,
        }

        const rawShift = rawShifts.find(s => s.id === merge.shiftId)
        const booking = rawShift ? bookingsForShift(rawShift, bookingsById, bookingsByAvailPk)[0] : null
        if (!booking?.listing_id) return base // nothing to validate a swap against — read-only finding only
        const anchored: OptimizerItem = { ...base, bookingId: booking.id }

        // A move that already ran its course (guest declined, rebooked, expired)
        // still has to reach the overlay so the grid can show what happened —
        // checked before the notice gate, since a finished move's runway is moot.
        const settled = await findAnyBoatSwapProposal(supabase, booking.id)
        if (settled && !OPEN_PROPOSAL_STATUSES.includes(settled.status)) {
          return withProposal(anchored, settled, booking.customer_name)
        }

        // Not enough runway to bother the guest — still worth reporting the
        // finding, just never contacted about it.
        if (!hasEnoughNotice(booking.start_time)) return anchored

        const existing = await findOpenBoatSwapProposal(supabase, booking.id)
        if (existing) return withProposal(anchored, existing, booking.customer_name)
        // Sequential, across every move type (Beer, 2026-08-23): a day
        // already mid-conversation with one guest never gets a second,
        // different guest asked to rework it too.
        if (await openMoveRequestExists(supabase, merge.date)) return base

        const { data: listing } = await supabase.from('cruise_listings').select('slug').eq('id', booking.listing_id).single()
        if (!listing?.slug) return base

        const swapBooking = toBoatSwapBooking(booking)
        const validated = await validateBoatSwap(merge, swapBooking, listing.slug)
        if (!validated) return base

        const outcome = await draftBoatSwap(supabase, merge, swapBooking, validated, { source: 'admin/planning/optimizer', listingSlug: listing.slug })
        if (outcome !== 'drafted') return base

        const drafted = await findOpenBoatSwapProposal(supabase, booking.id)
        const payload = (drafted?.payload ?? {}) as { sms_text?: string; email_subject?: string; email_body?: string }
        return { ...base, proposalId: drafted?.id, guestName: swapBooking.customerName, smsText: payload.sms_text, emailSubject: payload.email_subject, emailBody: payload.email_body }
      }),
    )
    items.push(...boatSwapItems)

    // Persist same-day findings — see the file doc comment on why. Runs after
    // gaps AND boat swaps are both in `items` (not inline per-gap) so the
    // finding's own already-built OptimizerItem is what's recorded, rather
    // than reconstructing the same fields twice.
    await Promise.all(items.map(item => recordSameDayFinding(supabase, item)))

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
        const base: OptimizerItem = {
          kind: 'cross_day_consolidation',
          date: c.fromDate,
          boat: c.boat,
          summary: `${c.booking.customerName ?? 'Guest'} (${c.booking.guestCount ?? '?'} guests, ${c.fromDate}) could join ${c.toDate}'s ${c.boat} departure (${c.receivingBooking.guestCount ?? '?'} already booked, ${c.capacity - c.combinedGuestCount} spots would remain) — ${c.eliminatesShift ? `frees the whole ${c.fromDate} shift` : `shortens the ${c.fromDate} shift`}.`,
          estSavingCents: c.estSavingCents,
          toDate: c.toDate,
          bookingId: c.booking.id,
        }

        // A move that already ran its course (guest declined, rebooked, expired)
        // still has to reach the overlay so the grid can show what happened —
        // checked before the notice gate, since a finished move's runway is moot.
        const settled = await findAnyCrossDayProposal(supabase, c.booking.id)
        if (settled && !OPEN_PROPOSAL_STATUSES.includes(settled.status)) {
          return withProposal(base, settled, c.booking.customerName)
        }

        // Not enough runway to bother the guest — still worth reporting the
        // finding, just never contacted about it.
        if (!hasEnoughNotice(c.booking.startTime)) return base

        const existing = await findOpenCrossDayProposal(supabase, c.booking.id)
        const drafted =
          existing ??
          (await (async () => {
            // Sequential, across every move type (Beer, 2026-08-23): a day
            // already mid-conversation with one guest never gets a second,
            // different guest asked to rework it too — check BOTH days this
            // move touches, not just the one being vacated.
            const dayClaimed =
              (await openMoveRequestExists(supabase, c.fromDate)) || (await openMoveRequestExists(supabase, c.toDate))
            if (dayClaimed) return null
            const outcome = await draftCrossDayConsolidation(supabase, c, { source: 'admin/planning/optimizer' })
            return outcome === 'drafted' ? await findOpenCrossDayProposal(supabase, c.booking.id) : null
          })())

        return withProposal(base, drafted, c.booking.customerName)
      }),
    )
    items.push(...crossDayItems)

    return apiOk({ items, from, to })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
