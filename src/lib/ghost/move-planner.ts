import type { createAdminClient } from '@/lib/supabase/admin'
import { computeDayFacts, type OpsReviewShift, type MergeCandidate } from './ops-review'
import {
  findCrossDayConsolidationCandidates,
  type ConsolidationShift,
  type ConsolidationBooking,
} from './cross-day-consolidation'
import { draftCrossDayConsolidation } from './cross-day-move-drafter'
import { validateBoatSwap, draftBoatSwap, type BoatSwapBooking } from './boat-swap-drafter'
import { openMoveRequestExists, prepareTimeMoves, type PreparedTimeMove } from './guest-move-drafter'
import { resolveDayPlan, type DayOptimizerCandidate, type PriorDecision } from './day-optimizer-agent'
import { isOptedOut } from './reschedule-opt-outs'
import { OPTIMIZE_HORIZON_DAYS, hasEnoughNotice } from './rulebook'
import { deriveOptimizerState, type OptimizerDisplayState, type ProposalOutcome } from '@/lib/scheduling/optimizer-status'
import { amsterdamToday, formatAmsterdamTime } from '@/lib/utils'
import type { ExtrasLineItem } from '@/lib/catering/filter'

/**
 * The move planner — ONE place that finds every kind of guest move, lets the
 * day optimizer agent pick between moves competing for the same day, and
 * drafts the winners. Three callers, one decision step:
 *   - GET /api/admin/planning/optimizer (the panel): today → horizon, drafts
 *     every allowed move.
 *   - the nightly ghost-ops cron (draftNightlyMove): tomorrow → horizon,
 *     drafts at most ONE move per run, the best allowed one.
 *   - every new booking (guest-move-drafter.ts's draftGuestMoveForNewBooking):
 *     only drafts for the new booking's own date.
 * Before this, each of those raced first-come for the day: the time-shift
 * ask came from guest-move-drafter.ts on its own, boat swaps and cross-day
 * moves only from the panel, and whichever wrote its ask first claimed the day.
 *
 * The move kinds, all `guest_move_request` proposals (payload.move_type):
 *   - time_shift  — same boat, same day, earlier/later to close a paid gap
 *   - boat_swap   — same time, other boat, frees a captain for the day
 *   - cross_day   — join an existing departure on a neighbouring day
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

/** Statuses that mean "this ask is still live" — an open proposal blocks
 *  re-drafting the same move, and is what the panel can still act on. */
export const OPEN_PROPOSAL_STATUSES = ['shadow', 'sending', 'approved']

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
  moveType: 'cross_day' | 'boat_swap' | 'time_shift',
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

const findAnyTimeShiftProposal = (supabase: AdminClient, bookingId: string) =>
  findProposal(supabase, bookingId, 'time_shift', ALL_PROPOSAL_STATUSES)

/** Folds a proposal row's id, drafted copy and derived lifecycle state onto a
 *  finding. Kept in one place so cross-day and boat-swap items can never drift
 *  apart in what the overlay receives. */
function withProposal(base: OptimizerItem, row: ProposalRow | null, guestName: string | null | undefined): OptimizerItem {
  // guestName belongs to the booking, not to whether a proposal row exists
  // yet — merge it unconditionally, then layer in the row-dependent fields
  // (proposal id, drafted copy, lifecycle state) only when there is a row.
  const withGuest: OptimizerItem = { ...base, guestName: guestName ?? base.guestName }
  if (!row) return withGuest
  const payload = (row.payload ?? {}) as { sms_text?: string; email_subject?: string; email_body?: string }
  return {
    ...withGuest,
    proposalId: row.id,
    smsText: payload.sms_text,
    emailSubject: payload.email_subject,
    emailBody: payload.email_body,
    state: deriveOptimizerState(row.status, (row.outcome ?? null) as ProposalOutcome | null),
  }
}

export interface OptimizerItem {
  kind: 'same_day_gap' | 'same_day_merge' | 'cross_day_consolidation' | 'same_day_time_move'
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
  /** Why no ask was drafted for this finding. `notAskedBy` says whether a
   *  hard rule held it back (notice window, opt-out, day already has an open
   *  ask, no bookable slot…) or the day optimizer agent chose another move. */
  notAskedReason?: string
  notAskedBy?: 'rule' | 'agent'
  /** same_day_time_move only: the departure time the guest would be asked to move to. */
  proposedStartAt?: string
}

/** A candidate mid-preparation: either already resolved to a plain finding
 *  (nothing to draft, or draft-worthiness could not be established), or
 *  ready to draft pending resolveDayPlan's decision (`live` + a deferred
 *  `finish` that actually drafts and returns the final item). */
export type PreparedItem =
  | { item: OptimizerItem }
  | {
      item: OptimizerItem
      live: DayOptimizerCandidate
      finish: (ctx: FinishContext) => Promise<OptimizerItem>
      /** boat_swap only: a live, non-mutating FareHarbor re-validate. */
      recheck?: () => Promise<{ bookable: boolean; note?: string }>
    }

export interface FinishContext {
  /** ops_events / proposal source tag of whoever triggered the draft. */
  source: string
  /** Why now, in the proposal's reasoning (time shifts only). */
  reasoningSuffix: string
}

/** The same two checks the drafters themselves run before writing an ask
 *  (no contact detail → nothing to send; opted out → never ask) — run
 *  BEFORE a candidate competes for its day, not after it has already won. */
async function isContactable(supabase: AdminClient, email: string | null, phone: string | null): Promise<boolean> {
  if (!email && !phone) return false
  return !(await isOptedOut(supabase, { email, phone }))
}

/** A finding no ask was drafted for, and the hard rule that held it back. */
function held(item: OptimizerItem, reason: string): OptimizerItem {
  return { ...item, notAskedReason: reason, notAskedBy: 'rule' }
}

const REASON = {
  noBooking: 'No single booking behind this departure to ask.',
  notice: 'Too close to departure to ask the guest.',
  uncontactable: 'Guest has no contact details, or opted out of move requests.',
  dayClaimed: 'Another move is already open for this day — one ask per day.',
  noListing: "Couldn't resolve the cruise listing to check availability.",
  noSwapSlot: 'FareHarbor has no bookable slot on the other boat at this time.',
  draftFailed: "The message couldn't be drafted — it will be retried.",
}

export interface PlannedMoves {
  /** same_day_gap findings — informational, never an ask on their own. */
  gapItems: OptimizerItem[]
  /** Every move candidate: either a finished finding, or live and awaiting the day plan. */
  prepared: PreparedItem[]
}

/**
 * Finds and prepares every move in [from, to]. Nothing is drafted here.
 * `extraTimeMoves` lets a caller that already prepared its own time shift
 * (the new-booking trigger) hand it in instead of having it prepared twice;
 * `includeTimeMoves: false` skips preparing them here.
 */
export async function planMoves(
  supabase: AdminClient,
  opts: { from: string; to: string; includeTimeMoves?: boolean; extraTimeMoves?: PreparedTimeMove[] },
): Promise<PlannedMoves> {
  const { from, to } = opts
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
  if (shiftsRes.error) throw new Error(shiftsRes.error.message)
  if (bookingsRes.error) throw new Error(bookingsRes.error.message)

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

  const gapItems: OptimizerItem[] = []

  // ── Same-day facts (ops-review.ts's computeDayFacts, run per day). ──
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
      // ops review already lives with.
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
      gapItems.push({
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

  // ── Boat swaps. ──
  const boatSwaps = await Promise.all(
    allMergeCandidates.map(async (merge): Promise<PreparedItem> => {
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
      if (!booking?.listing_id) return { item: held(base, REASON.noBooking) }
      const anchored: OptimizerItem = { ...base, bookingId: booking.id }

      // A move that already ran its course (guest declined, rebooked, expired)
      // still has to reach the overlay so the grid can show what happened —
      // checked before the notice gate, since a finished move's runway is moot.
      const settled = await findAnyBoatSwapProposal(supabase, booking.id)
      if (settled && !OPEN_PROPOSAL_STATUSES.includes(settled.status)) {
        return { item: withProposal(anchored, settled, booking.customer_name) }
      }
      if (!hasEnoughNotice(booking.start_time)) return { item: held(anchored, REASON.notice) }
      // A guest we can't (or mustn't) contact never competes for the day's
      // one ask — otherwise the day optimizer could pick them, the draft
      // would silently no-op, and the reachable guest would never be asked.
      if (!(await isContactable(supabase, booking.customer_email, booking.customer_phone))) {
        return { item: held(anchored, REASON.uncontactable) }
      }
      const existing = await findOpenBoatSwapProposal(supabase, booking.id)
      if (existing) return { item: withProposal(anchored, existing, booking.customer_name) }
      if (await openMoveRequestExists(supabase, merge.date)) return { item: held(anchored, REASON.dayClaimed) }

      const { data: listing } = await supabase.from('cruise_listings').select('slug').eq('id', booking.listing_id).single()
      if (!listing?.slug) return { item: held(anchored, REASON.noListing) }

      const swapBooking = toBoatSwapBooking(booking)
      const validated = await validateBoatSwap(merge, swapBooking, listing.slug)
      if (!validated) return { item: held(anchored, REASON.noSwapSlot) }

      return {
        item: anchored,
        live: { id: `boat_swap:${booking.id}`, type: 'boat_swap', daysTouched: [merge.date], summary: base.summary, estSavingCents: merge.estSavingCents },
        recheck: async () => {
          const revalidated = await validateBoatSwap(merge, swapBooking, listing.slug)
          return revalidated ? { bookable: true } : { bookable: false, note: 'No longer bookable at this exact time.' }
        },
        finish: async ({ source }) => {
          const outcome = await draftBoatSwap(supabase, merge, swapBooking, validated, { source, listingSlug: listing.slug })
          if (outcome !== 'drafted') return held(anchored, REASON.draftFailed)
          const drafted = await findOpenBoatSwapProposal(supabase, booking.id)
          return withProposal(anchored, drafted, swapBooking.customerName)
        },
      }
    }),
  )

  // ── Cross-day consolidation. ──
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
  const crossDayCandidates = findCrossDayConsolidationCandidates(consolidationShifts, boatCapacityByBoat)

  const crossDays = await Promise.all(
    crossDayCandidates.map(async (c): Promise<PreparedItem> => {
      const base: OptimizerItem = {
        kind: 'cross_day_consolidation',
        date: c.fromDate,
        boat: c.boat,
        summary: `${c.booking.customerName ?? 'Guest'} (${c.booking.guestCount ?? '?'} guests, ${c.fromDate}) could join ${c.toDate}'s ${c.boat} departure (${c.receivingBooking.guestCount ?? '?'} already booked, ${c.capacity - c.combinedGuestCount} spots would remain) — ${c.eliminatesShift ? `frees the whole ${c.fromDate} shift` : `shortens the ${c.fromDate} shift`}.`,
        estSavingCents: c.estSavingCents,
        toDate: c.toDate,
        bookingId: c.booking.id,
      }

      const settled = await findAnyCrossDayProposal(supabase, c.booking.id)
      if (settled && !OPEN_PROPOSAL_STATUSES.includes(settled.status)) {
        return { item: withProposal(base, settled, c.booking.customerName) }
      }
      if (!hasEnoughNotice(c.booking.startTime)) return { item: held(base, REASON.notice) }
      if (!(await isContactable(supabase, c.booking.customerEmail, c.booking.customerPhone))) {
        return { item: held(base, REASON.uncontactable) }
      }
      const existing = await findOpenCrossDayProposal(supabase, c.booking.id)
      if (existing) return { item: withProposal(base, existing, c.booking.customerName) }
      // Both days this move touches — an open ask on either blocks it.
      const dayClaimed =
        (await openMoveRequestExists(supabase, c.fromDate)) || (await openMoveRequestExists(supabase, c.toDate))
      if (dayClaimed) return { item: held(base, REASON.dayClaimed) }

      return {
        item: base,
        live: { id: `cross_day:${c.booking.id}`, type: 'cross_day', daysTouched: [c.fromDate, c.toDate], summary: base.summary, estSavingCents: c.estSavingCents },
        finish: async ({ source }) => {
          const outcome = await draftCrossDayConsolidation(supabase, c, { source })
          if (outcome !== 'drafted') return held(base, REASON.draftFailed)
          const drafted = await findOpenCrossDayProposal(supabase, c.booking.id)
          return withProposal(base, drafted, c.booking.customerName)
        },
      }
    }),
  )

  // ── Time shifts (close a paid gap on the same boat). ──
  const timeMoves: PreparedItem[] = []
  const toTimeItem = (date: string, candidate: PreparedTimeMove['candidate']): OptimizerItem => ({
    kind: 'same_day_time_move',
    date,
    boat: candidate.boat,
    summary: `${candidate.booking.customerName ?? 'Guest'} (${candidate.booking.guestCount ?? '?'} guests) could sail ${formatAmsterdamTime(candidate.proposedStartAt)} instead of ${formatAmsterdamTime(candidate.currentStartAt)} on ${candidate.boat} — closes a ${candidate.gapMinutes} min paid gap.`,
    estSavingCents: candidate.estSavingCents,
    bookingId: candidate.bookingId,
    proposedStartAt: candidate.proposedStartAt,
  })
  const toLiveTimeMove = (t: PreparedTimeMove): PreparedItem => {
    const item = toTimeItem(t.date, t.candidate)
    return {
      item,
      live: { id: `time_move:${t.candidate.bookingId}`, type: 'time_move', daysTouched: [t.date], summary: item.summary, estSavingCents: t.candidate.estSavingCents },
      finish: async ({ source, reasoningSuffix }) => {
        const outcome = await t.draft({ source, reasoningSuffix })
        if (outcome !== 'drafted') return held(item, REASON.draftFailed)
        const drafted = await findAnyTimeShiftProposal(supabase, t.candidate.bookingId)
        return withProposal(item, drafted, t.candidate.booking.customerName)
      },
    }
  }
  for (const t of opts.extraTimeMoves ?? []) timeMoves.push(toLiveTimeMove(t))
  if (opts.includeTimeMoves !== false) {
    const { live, claimed } = await prepareTimeMoves(supabase, from, to)
    for (const t of live) timeMoves.push(toLiveTimeMove(t))
    for (const { date, candidate } of claimed) {
      const item = toTimeItem(date, candidate)
      const own = await findAnyTimeShiftProposal(supabase, candidate.bookingId)
      timeMoves.push({ item: own ? withProposal(item, own, candidate.booking.customerName) : held(item, REASON.dayClaimed) })
    }
  }

  return { gapItems, prepared: [...boatSwaps, ...crossDays, ...timeMoves] }
}

type LivePrepared = Extract<PreparedItem, { live: DayOptimizerCandidate }>
export const isLive = (p: PreparedItem): p is LivePrepared => 'live' in p

/**
 * The agent's decision for an identical conflict is reused for 24h instead
 * of asking again — on every panel open and every nightly run the same
 * candidates would otherwise re-run the agent (cost) and could come out
 * differently (the panel and the nightly run disagreeing). Only real agent
 * decisions are reused; a fallback decision retries the agent next time.
 */
function priorDecisionLookup(supabase: AdminClient) {
  return async (clusterKey: string): Promise<PriorDecision | null> => {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data } = await supabase
        .from('ops_events')
        .select('payload')
        .eq('source', 'ghost/day-optimizer-agent')
        .eq('payload->>cluster_key', clusterKey)
        .eq('payload->>used_fallback', 'false')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const payload = (data as { payload?: { picked?: string[]; per_candidate?: Record<string, string | null> } } | null)?.payload
      if (!payload?.picked) return null
      return { picked: payload.picked, perCandidate: payload.per_candidate ?? {} }
    } catch {
      return null
    }
  }
}

/** Runs the day plan over every live candidate. */
export async function decideMoves(supabase: AdminClient, prepared: PreparedItem[]) {
  const live = prepared.filter(isLive)
  const recheckById = new Map(live.filter(p => p.recheck).map(p => [p.live.id, p.recheck!]))
  return resolveDayPlan(
    live.map(p => p.live),
    {
      recheckBoatSwap: async id => (await recheckById.get(id)?.()) ?? { bookable: false, note: 'Could not re-check.' },
      priorDecision: priorDecisionLookup(supabase),
    },
  )
}

/**
 * Finishes every prepared item: drafts the allowed live ones `shouldDraft`
 * accepts, explains the ones the agent passed over, and leaves allowed-but-
 * not-this-run ones as plain findings (the nightly run drafts one at a time).
 */
export async function finishMoves(
  prepared: PreparedItem[],
  plan: Awaited<ReturnType<typeof decideMoves>>,
  ctx: FinishContext,
  shouldDraft: (p: LivePrepared) => boolean = () => true,
): Promise<{ items: OptimizerItem[]; drafted: number }> {
  let drafted = 0
  const items = await Promise.all(
    prepared.map(async p => {
      if (!isLive(p)) return p.item
      const decision = plan.get(p.live.id)
      if (!decision?.allowed) {
        return { ...p.item, notAskedReason: decision?.reasoning ?? 'Another move was chosen for this day.', notAskedBy: 'agent' as const }
      }
      if (!shouldDraft(p)) return p.item
      const done = await p.finish(ctx)
      if (done.proposalId) drafted++
      return done
    }),
  )
  return { items, drafted }
}

/** The one move the nightly run drafts: the highest-saving move the day plan allows. */
export function pickNightlyMove(prepared: PreparedItem[], plan: Awaited<ReturnType<typeof decideMoves>>): LivePrepared | null {
  return (
    prepared
      .filter(isLive)
      .filter(p => plan.get(p.live.id)?.allowed)
      .sort((a, b) => (b.live.estSavingCents ?? 0) - (a.live.estSavingCents ?? 0))[0] ?? null
  )
}

/**
 * The nightly run (ghost-ops cron): tomorrow → horizon, all three move
 * kinds, at most ONE draft per run — the highest-saving move the day plan
 * allows. Outreach trickles; the rest wait for the next run or the panel.
 */
export async function draftNightlyMove(supabase: AdminClient): Promise<'drafted' | 'skipped'> {
  try {
    const { prepared } = await planMoves(supabase, { from: amsterdamToday(1), to: amsterdamToday(OPTIMIZE_HORIZON_DAYS) })
    const plan = await decideMoves(supabase, prepared)
    const best = pickNightlyMove(prepared, plan)
    if (!best) return 'skipped'
    const done = await best.finish({
      source: 'ghost/guest-move-drafter:nightly',
      reasoningSuffix: `the best opportunity in the next ${OPTIMIZE_HORIZON_DAYS} days`,
    })
    return done.proposalId ? 'drafted' : 'skipped'
  } catch (err) {
    console.error('[move-planner] nightly run failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}

/**
 * The new-booking trigger's decision step: the time shift it already
 * prepared competes with every boat swap / cross-day move touching the same
 * date (cross-day moves reach one day either side). Only moves on that date
 * are drafted. Returns how many were drafted (0 or 1 — one ask per day).
 */
export async function draftMovesForDate(
  supabase: AdminClient,
  date: string,
  timeMove: PreparedTimeMove,
): Promise<number> {
  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  const { prepared } = await planMoves(supabase, { from: shift(-1), to: shift(1), includeTimeMoves: false, extraTimeMoves: [timeMove] })
  const plan = await decideMoves(supabase, prepared)
  const { drafted } = await finishMoves(
    prepared,
    plan,
    { source: 'ghost/guest-move-drafter:new-booking', reasoningSuffix: 'a new booking just revealed this opportunity' },
    p => p.live.daysTouched.includes(date),
  )
  return drafted
}
