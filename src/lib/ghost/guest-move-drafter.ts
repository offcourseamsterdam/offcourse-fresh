import { CLAUDE_DRAFTER_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasCatering, type ExtrasLineItem } from '@/lib/catering/filter'
import { deriveOperationalProfile } from '@/lib/ops/profile'
import { emitOpsEvent } from '@/lib/ops/events'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import { getFareHarborClient } from '@/lib/fareharbor/client'
import type { AvailabilitySlot } from '@/types'
import { computeDayFacts, type OpsReviewShift } from './ops-review'
import { PLACEHOLDER_CONTACT, toVerdict, type DryRunVerdict } from './dry-run'
import { isOptedOut } from './reschedule-opt-outs'
import { extractJson } from './ops-drafters'
import {
  MIN_GAP_MINUTES,
  MIN_GAP_SAVING_CENTS,
  OPTIMIZE_HORIZON_DAYS,
  GUEST_MOVE_EXPIRY_HOURS,
  GUEST_MOVE_PROMPT,
  moveIncentiveFor,
  moveContactChannel,
  hasEnoughNotice,
} from './rulebook'
import { amsterdamToday, formatAmsterdamTime } from '@/lib/utils'

/**
 * Guest-move drafter — the outreach half of the AI Operations Engine (PRD
 * "Smart Guest Suggestions" + "Decision Engine", sequential outreach).
 *
 * When a day has a paid gap big enough to matter, the Ghost picks ONE
 * booking that could close it, and drafts the ask: an SMS + email with the
 * offer (new time, same price, an incentive on us) and a tokened response
 * link. A human approves the send; the guest taps Yes / Let me check / Keep
 * my time; every answer lands in ops_events — the future acceptance-
 * probability training data.
 *
 * Two triggers, one shared core (craftAndInsertMoveProposal):
 *   - draftGuestMoveRequest() — nightly, scans the whole horizon, drafts the
 *     single best opportunity across it.
 *   - draftGuestMoveForNewBooking(date) — event-driven (Beer 2026-07-04:
 *     "every time a new booking comes in"), fired right after a booking is
 *     confirmed, scoped to just that booking's date.
 *
 * HARD RULES, all enforced here in code (never in the prompt):
 *   - sequential: at most ONE open move request per day, ever. Guests are
 *     never raced against each other (PRD: "Beslissingen moeten sequentieel").
 *   - private cruises CAN be asked to move (Beer 2026-07-04, same threshold
 *     as shared) — but only a TIME/boat change, never merged onto another
 *     party's departure (deriveOperationalProfile.allowMerge stays false for
 *     private; this drafter only ever moves one booking's time anyway).
 *   - bookings WITH catering/drinks are never asked (Beer 2026-07-04: the
 *     supplier order is already placed; those guests are left alone).
 *   - departures carrying MORE than one booking are skipped — moving them
 *     means asking several parties at once, which breaks sequentiality.
 *   - only gaps worth ≥ €20 AND ≥ 45 min get an ask (don't pester guests
 *     for pennies).
 *   - the send itself is a human click (autonomy: propose, ceiling ask), and
 *     a guest "yes" still leaves the actual FareHarbor rebook to a human.
 */

// Thresholds live in the rulebook (single source, shown on /admin/ghost/rulebook);
// re-exported here so existing imports/tests keep working.
export { MIN_GAP_MINUTES, MIN_GAP_SAVING_CENTS, OPTIMIZE_HORIZON_DAYS } from './rulebook'

export interface MoveBooking {
  id: string
  category: string | null
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  extrasSelected: ExtrasLineItem[] | null
  listingId: string | null
  listingTitle: string | null
  guestCount: number | null
  totalCents: number | null
  fareharborAvailabilityPk: number | null
  /** Admin-set "never propose a move on this one" (Beer, 2026-08-23: anniversary/birthday bookings). */
  noRescheduleAsk: boolean
}

export interface MoveCandidate {
  shiftId: string
  bookingId: string
  boat: string
  currentStartAt: string
  currentEndAt: string
  proposedStartAt: string
  proposedEndAt: string
  gapMinutes: number
  estSavingCents: number
  booking: MoveBooking
}

interface ShiftWithBooking extends OpsReviewShift {
  bookingId: string | null
  availabilityPk: number | null
}

function shiftDurationMs(s: OpsReviewShift): number {
  return new Date(s.endAt).getTime() - new Date(s.startAt).getTime()
}

function shifted(iso: string, deltaMs: number): string {
  return new Date(new Date(iso).getTime() + deltaMs).toISOString()
}

/**
 * Deterministic candidate selection. Walks the gaps from most to least
 * valuable; per gap first tries pulling the LATER sailing earlier (butt
 * against the previous one), then pushing the EARLIER sailing later. Returns
 * the single best qualifying candidate, or null — one ask per day, max.
 */
export function selectMoveCandidate(
  shifts: ShiftWithBooking[],
  bookingsById: Map<string, MoveBooking>,
  bookingsByAvailPk: Map<number, MoveBooking[]>,
): MoveCandidate | null {
  const facts = computeDayFacts(shifts[0] ? shifts[0].startAt.slice(0, 10) : '', shifts, [], [])
  const shiftById = new Map(shifts.map(s => [s.id, s]))

  const gaps = [...facts.gaps]
    .filter(g => g.minutes >= MIN_GAP_MINUTES && (g.estIdleCostCents ?? 0) >= MIN_GAP_SAVING_CENTS)
    .sort((a, b) => (b.estIdleCostCents ?? 0) - (a.estIdleCostCents ?? 0))

  for (const gap of gaps) {
    const earlier = shiftById.get(gap.afterShiftId)
    const later = shiftById.get(gap.beforeShiftId)
    if (!earlier || !later) continue

    // Option 1: pull the later sailing earlier, to start when the previous ends.
    // Option 2: push the earlier sailing later, to end when the next starts.
    const options: Array<{ shift: ShiftWithBooking; newStart: string }> = [
      { shift: later, newStart: earlier.endAt },
      { shift: earlier, newStart: shifted(later.startAt, -shiftDurationMs(earlier)) },
    ]

    for (const { shift, newStart } of options) {
      const booking = resolveSingleBooking(shift, bookingsById, bookingsByAvailPk)
      if (!booking) continue // no booking, or a multi-booking departure (never race guests)
      // Private cruises CAN be time-moved (Beer 2026-07-04, same threshold as
      // shared) — allowMerge is the only flag this drafter never touches, and
      // it never merges anyone (it moves ONE booking's time, always onto an
      // empty slot). Kept as an explicit check so a future merge-style
      // candidate here would still respect the profile.
      if (!deriveOperationalProfile(booking.category).allowTimeChange) continue
      if (hasCatering(booking.extrasSelected)) continue // drinks/catering aboard: leave them alone
      if (booking.noRescheduleAsk) continue // admin flagged this one — anniversary/birthday etc (Beer, 2026-08-23)
      if (!booking.customerEmail && !booking.customerPhone) continue // nobody to ask

      return {
        shiftId: shift.id,
        bookingId: booking.id,
        boat: shift.boat,
        currentStartAt: shift.startAt,
        currentEndAt: shift.endAt,
        // normalize both paths to full ISO (one comes straight from a DB string)
        proposedStartAt: new Date(newStart).toISOString(),
        proposedEndAt: shifted(newStart, shiftDurationMs(shift)),
        gapMinutes: gap.minutes,
        estSavingCents: gap.estIdleCostCents ?? 0,
        booking,
      }
    }
  }
  return null
}

// ── Dry-run: snap the geometric ideal to a REAL FareHarbor slot ──────────────

export interface SnapInput {
  /** The booking's current departure (ISO). */
  currentStartAt: string
  /** The geometric ideal from the gap math (ISO) — may not exist as an FH slot. */
  idealStartAt: string
  durationMinutes: number
  boatKey: 'diana' | 'curacao'
  category: string | null
  guests: number
  hourlyRateCents: number | null
}

export interface SnappedSlot {
  availPk: number
  customerTypeRatePk: number
  startAt: string
  optionName: string
  /** How many idle minutes this move actually recovers (≤ the full gap). */
  recoveredMinutes: number
  estSavingCents: number
  /** true when the real slot differs from the geometric ideal. */
  snapped: boolean
}

/**
 * Pure: pick the real availability slot closest to the geometric ideal that
 * still shrinks the gap enough to be worth asking. The gap math proposes
 * times derived from shift geometry (butting sailings together); FareHarbor
 * only offers its own slot grid — verified live 2026-07-04: display times
 * come back as "3pm", so all matching here is on startAt ISO, never on
 * display strings.
 *
 * Window: strictly between the current departure and the ideal (inclusive of
 * the ideal) — any slot in that window reduces the gap; anything outside it
 * would make things worse or move the guest for nothing.
 */
export function pickSnapSlot(slots: AvailabilitySlot[], input: SnapInput): SnappedSlot | null {
  const current = new Date(input.currentStartAt).getTime()
  const ideal = new Date(input.idealStartAt).getTime()
  if (current === ideal) return null
  const [windowMin, windowMax] = ideal < current ? [ideal, current - 1] : [current + 1, ideal]

  const candidates = slots
    .map(slot => {
      const t = new Date(slot.startAt).getTime()
      if (t < windowMin || t > windowMax) return null

      // Same boat + same duration — the ask promises "same boat, same cruise".
      let cts = slot.customerTypes.filter(
        ct => ct.boatId === input.boatKey && ct.durationMinutes === input.durationMinutes,
      )
      // Party fit only for shared (private types list min/max party as 1/1 —
      // you book the boat, not seats; a party filter would wrongly exclude it).
      if (input.category !== 'private') {
        cts = cts.filter(ct => input.guests >= ct.minimumParty && input.guests <= ct.maximumParty)
      }
      if (!cts.length) return null
      const ct = [...cts].sort((a, b) => a.priceCents - b.priceCents)[0]

      const recoveredMinutes = Math.round(Math.abs(current - t) / 60_000)
      return { slot, ct, recoveredMinutes, distance: Math.abs(t - ideal) }
    })
    .filter((c): c is NonNullable<typeof c> => c !== null)
    // Closest to the ideal wins; recovery size breaks ties.
    .sort((a, b) => a.distance - b.distance || b.recoveredMinutes - a.recoveredMinutes)

  for (const c of candidates) {
    const estSavingCents =
      input.hourlyRateCents != null ? Math.round((c.recoveredMinutes / 60) * input.hourlyRateCents) : 0
    // Same thresholds as the gap itself — a snapped move must still be worth
    // bothering a guest about.
    if (c.recoveredMinutes < MIN_GAP_MINUTES || estSavingCents < MIN_GAP_SAVING_CENTS) continue
    return {
      availPk: c.slot.pk,
      customerTypeRatePk: c.ct.pk,
      startAt: new Date(c.slot.startAt).toISOString(),
      optionName: c.ct.name,
      recoveredMinutes: c.recoveredMinutes,
      estSavingCents,
      snapped: new Date(c.slot.startAt).getTime() !== ideal,
    }
  }
  return null
}

/** Boat display name → the boat key used in availability customer types. */
export function boatKeyFromName(name: string | null | undefined): 'diana' | 'curacao' | null {
  const lower = (name ?? '').toLowerCase()
  if (lower.includes('diana')) return 'diana'
  if (lower.includes('cura')) return 'curacao'
  return null
}

export interface ValidatedMove {
  snap: SnappedSlot
  verdict: DryRunVerdict
}

/**
 * The dry-run: resolve the candidate against live availability (through the
 * public 3-layer filters), snap to the nearest real slot that still pays,
 * and confirm with FareHarbor's own non-mutating validate — for the WHOLE
 * party (shared sends one customer per guest; private books the boat once).
 * Verified live: FH validates a target slot while the guest's original
 * booking still holds its own slot (non-overlapping windows). Returns null
 * when no real slot is worth asking about — no ask goes out on a guess.
 */
export async function validateMoveSlot(
  targetDate: string,
  candidate: MoveCandidate,
  listingSlug: string,
): Promise<ValidatedMove | null> {
  const boatKey = boatKeyFromName(candidate.boat)
  if (!boatKey) return null // never validate a guessed boat

  const durationMinutes = Math.round(
    (new Date(candidate.currentEndAt).getTime() - new Date(candidate.currentStartAt).getTime()) / 60_000,
  )
  const guests = candidate.booking.guestCount ?? 2

  const results = await fetchSearchResults(targetDate, guests)
  const listing = results.find(r => r.listing.slug === listingSlug)
  if (!listing) return null

  const snap = pickSnapSlot(listing.availableSlots, {
    currentStartAt: candidate.currentStartAt,
    idealStartAt: candidate.proposedStartAt,
    durationMinutes,
    boatKey,
    category: candidate.booking.category,
    guests,
    hourlyRateCents: candidate.estSavingCents > 0 && candidate.gapMinutes > 0
      ? Math.round((candidate.estSavingCents * 60) / candidate.gapMinutes)
      : null,
  })
  if (!snap) return null

  const fh = getFareHarborClient()
  const customerCount = candidate.booking.category === 'private' ? 1 : guests
  const validation = await fh.validateBooking(snap.availPk, {
    contact: PLACEHOLDER_CONTACT,
    customers: Array.from({ length: customerCount }, () => ({ customer_type_rate: snap.customerTypeRatePk })),
    note: 'Ghost dry-run capability check — not a real booking',
  })
  const verdict = toVerdict(validation, snap.availPk, new Date().toISOString())
  if (!verdict.is_bookable) return null

  return { snap, verdict }
}

/** A shift qualifies only when it maps to exactly ONE booking. */
function resolveSingleBooking(
  shift: ShiftWithBooking,
  byId: Map<string, MoveBooking>,
  byAvailPk: Map<number, MoveBooking[]>,
): MoveBooking | null {
  if (shift.bookingId) return byId.get(shift.bookingId) ?? null
  if (shift.availabilityPk != null) {
    const list = byAvailPk.get(shift.availabilityPk) ?? []
    return list.length === 1 ? list[0] : null
  }
  return null
}

// ── The drafter ──────────────────────────────────────────────────────────────

type AdminClient = ReturnType<typeof createAdminClient>

const SHIFT_SELECT =
  'id, date, start_at, end_at, status, staff_id, booking_id, fareharbor_availability_pk, staff(name, hourly_rate_cents), boats(name, max_capacity)'
const BOOKING_SELECT =
  'id, booking_date, category, customer_name, customer_email, customer_phone, extras_selected, listing_id, listing_title, guest_count, receipt_total, base_amount_cents, extras_amount_cents, fareharbor_availability_pk, no_reschedule_ask'

type RawShiftRow = {
  id: string
  start_at: string
  end_at: string
  status: string
  staff_id: string | null
  booking_id: string | null
  fareharbor_availability_pk: number | null
  staff: unknown
  boats: unknown
}
type RawBookingRow = {
  id: string
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
  no_reschedule_ask: boolean | null
}

function toMoveBooking(b: RawBookingRow): MoveBooking {
  return {
    id: b.id,
    category: b.category,
    customerName: b.customer_name,
    customerEmail: b.customer_email,
    customerPhone: b.customer_phone,
    extrasSelected: (b.extras_selected as ExtrasLineItem[] | null) ?? null,
    listingId: b.listing_id,
    listingTitle: b.listing_title,
    guestCount: b.guest_count,
    totalCents: b.receipt_total ?? (b.base_amount_cents ?? 0) + (b.extras_amount_cents ?? 0),
    fareharborAvailabilityPk: b.fareharbor_availability_pk,
    noRescheduleAsk: b.no_reschedule_ask ?? false,
  }
}

/**
 * The core candidate computation, shared by the nightly horizon scan and the
 * new-booking trigger — both end up with the same shape of raw rows for a
 * single day, just fetched differently (one big batched query vs. one
 * targeted single-day query).
 */
async function candidateFromDayRows(
  supabase: AdminClient,
  rawShifts: RawShiftRow[],
  dayBookings: MoveBooking[],
): Promise<MoveCandidate | null> {
  if (rawShifts.length < 2) return null // nothing to compare against yet

  const bookingsById = new Map(dayBookings.map(b => [b.id, b]))
  const bookingsByAvailPk = new Map<number, MoveBooking[]>()
  for (const b of dayBookings) {
    if (b.fareharborAvailabilityPk == null) continue
    const list = bookingsByAvailPk.get(b.fareharborAvailabilityPk) ?? []
    list.push(b)
    bookingsByAvailPk.set(b.fareharborAvailabilityPk, list)
  }

  const shifts: ShiftWithBooking[] = rawShifts.map(s => {
    const staff = s.staff as { name?: string; hourly_rate_cents?: number } | null
    const boat = s.boats as { name?: string; max_capacity?: number | null } | null
    const booking = s.booking_id ? bookingsById.get(s.booking_id) : null
    return {
      id: s.id,
      boat: boat?.name ?? '?',
      boatCapacity: boat?.max_capacity ?? null,
      startAt: s.start_at,
      endAt: s.end_at,
      status: s.status,
      staffId: s.staff_id,
      staffName: staff?.name ?? null,
      hourlyRateCents: staff?.hourly_rate_cents ?? null,
      category: booking?.category ?? null,
      guestCount: booking?.guestCount ?? null,
      listingTitle: booking?.listingTitle ?? null,
      noRescheduleAsk: booking?.noRescheduleAsk ?? false,
      bookingId: s.booking_id,
      availabilityPk: s.fareharbor_availability_pk,
    }
  })

  const candidate = selectMoveCandidate(shifts, bookingsById, bookingsByAvailPk)
  if (!candidate) return null
  // Not enough runway to bother the guest (Beer, 2026-08-23) — checked here,
  // not inside the pure selectMoveCandidate, so the underlying gap still
  // shows up in ops-review's read-only facts; only the ask is withheld.
  if (!hasEnoughNotice(candidate.currentStartAt)) return null
  // Permanent guest-level opt-out (Beer, 2026-08-23) — checked before the FH
  // dry-run even runs, not just before drafting, so a guest who already said
  // no never costs a wasted FareHarbor validate call either.
  if (await isOptedOut(supabase, { email: candidate.booking.customerEmail, phone: candidate.booking.customerPhone })) {
    return null
  }
  return candidate
}

/**
 * Sequential invariant: any not-yet-settled move request blocks a new one
 * for that date — ACROSS EVERY MOVE TYPE (Beer, 2026-08-23: "max one open
 * ask per day, any type"), not just this drafter's own same-day asks. Every
 * move-type drafter writes payload.target_date, so this one query already
 * covers same-day, cross-day, and boat-swap without needing a move_type
 * filter — exported so the Optimizer route can call it before drafting a
 * cross-day or boat-swap candidate too.
 */
export async function openMoveRequestExists(supabase: AdminClient, targetDate: string): Promise<boolean> {
  const { data } = await supabase
    .from('agent_proposals')
    .select('id')
    .eq('kind', 'guest_move_request')
    .eq('payload->>target_date', targetDate)
    .in('status', ['shadow', 'sending', 'approved'])
    .limit(1)
  return (data?.length ?? 0) > 0
}

/**
 * The dry-run gate between "the math found a candidate" and "Claude drafts
 * the ask": look up the booking's listing, snap the geometric ideal to a
 * real FareHarbor slot, and confirm it with FH's non-mutating validate.
 * Returns the candidate with its times/savings corrected to the REAL slot,
 * plus the verdict for the payload — or null, in which case no ask exists.
 */
async function dryRunCandidate(
  supabase: AdminClient,
  targetDate: string,
  candidate: MoveCandidate,
): Promise<{ candidate: MoveCandidate; validated: ValidatedMove; listingSlug: string; snappedFromIso: string | null } | null> {
  if (!candidate.booking.listingId) return null
  const { data: listing } = await supabase
    .from('cruise_listings')
    .select('slug')
    .eq('id', candidate.booking.listingId)
    .single()
  if (!listing?.slug) return null

  const validated = await validateMoveSlot(targetDate, candidate, listing.slug)
  if (!validated) return null

  const durationMs = new Date(candidate.currentEndAt).getTime() - new Date(candidate.currentStartAt).getTime()
  const snappedFromIso = validated.snap.snapped ? candidate.proposedStartAt : null
  return {
    candidate: {
      ...candidate,
      proposedStartAt: validated.snap.startAt,
      proposedEndAt: shifted(validated.snap.startAt, durationMs),
      estSavingCents: validated.snap.estSavingCents,
    },
    validated,
    listingSlug: listing.slug,
    snappedFromIso,
  }
}

/**
 * Claude drafts the SMS + email, then the shadow proposal is written and
 * logged. Shared by the nightly scan and the new-booking trigger — the only
 * difference between them is HOW a candidate + reasoning suffix were found,
 * never how the ask itself gets drafted.
 */
async function craftAndInsertMoveProposal(
  supabase: AdminClient,
  targetDate: string,
  candidate: MoveCandidate,
  opts: {
    reasoningSuffix: string
    source: string
    listingSlug: string
    verdict: DryRunVerdict
    customerTypeRatePk: number
    snappedFromIso: string | null
  },
): Promise<'drafted' | 'skipped'> {
  const currentTime = formatAmsterdamTime(candidate.currentStartAt)
  const proposedTime = formatAmsterdamTime(candidate.proposedStartAt)
  const totalEur = ((candidate.booking.totalCents ?? 0) / 100).toFixed(2)
  const incentive = moveIncentiveFor(candidate.booking.category, candidate.booking.extrasSelected)
  const channel = moveContactChannel(candidate.booking.customerPhone)

  const response = await meteredMessage('ghost_guest_move', {
    model: CLAUDE_DRAFTER_MODEL,
    max_tokens: 1000,
    messages: [
      {
        role: 'user',
        content: `${GUEST_MOVE_PROMPT}

THE ASK
- Guest: ${candidate.booking.customerName ?? 'guest'} · ${candidate.booking.guestCount ?? '?'} people · ${candidate.booking.listingTitle ?? 'cruise'} on ${targetDate}
- Current departure: ${currentTime} · proposed: ${proposedTime} (same boat: ${candidate.boat}, same duration, same price: €${totalEur})
- Incentive to offer: ${incentive ?? 'NONE — they already have Unlimited Drinks, so no sweetener this time; just make the plain ask'}
- Channel: ${channel.toUpperCase()}

Return JSON only:
${channel === 'sms'
  ? '{"sms_text": "<SMS incl {{link}}>"}'
  : `{"email_subject": "<subject>", "email_body": "<plain-text email incl {{link}}, with a one-line summary of their booking (date, time ${currentTime} → ${proposedTime}, party size, price unchanged €${totalEur})>"}`}`,
      },
    ],
  })

  const parsed = extractJson(firstText(response))
  const smsText = typeof parsed?.sms_text === 'string' ? parsed.sms_text : null
  const emailSubject = typeof parsed?.email_subject === 'string' ? parsed.email_subject : null
  const emailBody = typeof parsed?.email_body === 'string' ? parsed.email_body : null
  if (channel === 'sms' ? !smsText : !emailSubject || !emailBody) return 'skipped'
  if (channel === 'sms' ? !smsText!.includes('{{link}}') : !emailBody!.includes('{{link}}')) return 'skipped'

  const { data: inserted, error: insertError } = await supabase
    .from('agent_proposals')
    .insert({
      kind: 'guest_move_request',
      payload: JSON.parse(
        JSON.stringify({
          target_date: targetDate,
          booking_id: candidate.bookingId,
          shift_id: candidate.shiftId,
          guest_name: candidate.booking.customerName,
          guest_email: candidate.booking.customerEmail,
          guest_phone: candidate.booking.customerPhone,
          cruise_title: candidate.booking.listingTitle,
          guest_count: candidate.booking.guestCount,
          boat: candidate.boat,
          current_start_at: candidate.currentStartAt,
          proposed_start_at: candidate.proposedStartAt,
          proposed_end_at: candidate.proposedEndAt,
          gap_minutes: candidate.gapMinutes,
          est_saving_cents: candidate.estSavingCents,
          total_cents: candidate.booking.totalCents,
          incentive,
          sms_text: smsText,
          email_subject: emailSubject,
          email_body: emailBody,
          // Dry-run trail: the FH-confirmed slot behind the ask, and what the
          // send action re-validates right before dispatch (same party shape).
          listing_slug: opts.listingSlug,
          customer_type_rate_pk: opts.customerTypeRatePk,
          fh_customer_count: candidate.booking.category === 'private' ? 1 : (candidate.booking.guestCount ?? 2),
          verdict: opts.verdict,
          ...(opts.snappedFromIso ? { snapped_from: opts.snappedFromIso } : {}),
        }),
      ),
      reasoning: `Closing the ${candidate.gapMinutes} min gap on ${candidate.boat} (${targetDate}) saves ≈ €${(candidate.estSavingCents / 100).toFixed(2)} in paid waiting — ${opts.reasoningSuffix}. No catering aboard, single-party departure — safe to ask. Sequential: this is the only open ask for ${targetDate}.`,
      status: 'shadow',
      model: CLAUDE_DRAFTER_MODEL,
    })
    .select('id')
    .single()

  // Without this check, a failed write here fell through silently — inserted
  // stays undefined, emitOpsEvent still fires with proposalId: null, and the
  // function still returns 'drafted' as if a guest-move proposal had been
  // saved. Both callers (draftGuestMoveRequest, draftGuestMoveForNewBooking)
  // already wrap this in their own try/catch, so throwing here still resolves
  // to the correct 'skipped' outcome instead of a false-positive 'drafted'.
  if (insertError) throw new Error(`Could not create guest_move_request proposal: ${insertError.message}`)

  await emitOpsEvent({
    eventType: 'recommendation_created',
    actorType: 'agent',
    actorId: 'operations',
    proposalId: inserted?.id ?? null,
    bookingId: candidate.bookingId,
    shiftId: candidate.shiftId,
    source: opts.source,
    payload: { target_date: targetDate, est_saving_cents: candidate.estSavingCents, gap_minutes: candidate.gapMinutes },
  })

  return 'drafted'
}

export async function draftGuestMoveRequest(): Promise<'drafted' | 'skipped'> {
  try {
    const supabase = createAdminClient()
    const from = amsterdamToday(1)
    const to = amsterdamToday(OPTIMIZE_HORIZON_DAYS)

    // One query pair for the whole window, then per-day analysis.
    const [shiftsRes, bookingsRes] = await Promise.all([
      supabase
        .from('shifts')
        .select(`${SHIFT_SELECT}, date`)
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

    const bookingsByDate = new Map<string, MoveBooking[]>()
    for (const b of (bookingsRes.data ?? []) as RawBookingRow[]) {
      const date = (b as RawBookingRow & { booking_date: string | null }).booking_date
      if (!date) continue
      const list = bookingsByDate.get(date) ?? []
      list.push(toMoveBooking(b))
      bookingsByDate.set(date, list)
    }

    const rawShiftsByDate = new Map<string, RawShiftRow[]>()
    for (const s of (shiftsRes.data ?? []) as (RawShiftRow & { date: string })[]) {
      const list = rawShiftsByDate.get(s.date) ?? []
      list.push(s)
      rawShiftsByDate.set(s.date, list)
    }

    // Candidates per day — only days where a second sailing exists (one shift
    // has no gap to close). Best saving across the whole window wins.
    const candidates: Array<{ date: string; candidate: MoveCandidate }> = []
    for (const [date, rawShifts] of rawShiftsByDate) {
      const candidate = await candidateFromDayRows(supabase, rawShifts, bookingsByDate.get(date) ?? [])
      if (candidate) candidates.push({ date, candidate })
    }
    if (!candidates.length) return 'skipped' // optimal (or unaskable) days are a good outcome
    candidates.sort((a, b) => b.candidate.estSavingCents - a.candidate.estSavingCents)

    // Most valuable ask whose day is still free (sequential invariant), max
    // ONE draft per cron run — outreach trickles, it never floods.
    let picked: { date: string; candidate: MoveCandidate } | null = null
    for (const c of candidates) {
      if (!(await openMoveRequestExists(supabase, c.date))) {
        picked = c
        break
      }
    }
    if (!picked) return 'skipped'

    // Dry-run gate: no ask exists until FareHarbor confirmed the target slot.
    const dryRun = await dryRunCandidate(supabase, picked.date, picked.candidate)
    if (!dryRun) return 'skipped'

    return await craftAndInsertMoveProposal(supabase, picked.date, dryRun.candidate, {
      reasoningSuffix: `the best opportunity in the next ${OPTIMIZE_HORIZON_DAYS} days; FareHarbor confirmed the ${formatAmsterdamTime(dryRun.candidate.proposedStartAt)} slot`,
      source: 'ghost/guest-move-drafter:nightly',
      listingSlug: dryRun.listingSlug,
      verdict: dryRun.validated.verdict,
      customerTypeRatePk: dryRun.validated.snap.customerTypeRatePk,
      snappedFromIso: dryRun.snappedFromIso,
    })
  } catch (err) {
    console.error('[ghost/guest_move] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}

/**
 * Event-driven check (Beer 2026-07-04): "every time a new booking comes in"
 * — fired fire-and-forget right after a booking is confirmed (webhooks/stripe,
 * admin/booking-flow/book), scoped to just THAT booking's date. A new booking
 * can only ever create a gap-closing opportunity on its own date, so this
 * never re-scans the whole horizon — skip-first stays true (no second
 * booking on the date yet → zero DB writes, zero AI calls).
 *
 * Syncs shifts for the single date first: the new booking's shift may not
 * exist yet (shift generation is normally a nightly/manual batch job), and
 * gap analysis needs it to be there before it means anything.
 */
export async function draftGuestMoveForNewBooking(bookingDate: string): Promise<'drafted' | 'skipped'> {
  try {
    const supabase = createAdminClient()

    if (await openMoveRequestExists(supabase, bookingDate)) return 'skipped'

    const sync = await syncShiftsForRange(supabase, bookingDate, bookingDate)
    if ('error' in sync) {
      console.error('[ghost/guest_move] new-booking shift sync failed:', sync.error)
      return 'skipped'
    }

    const [shiftsRes, bookingsRes] = await Promise.all([
      supabase
        .from('shifts')
        .select(SHIFT_SELECT)
        .eq('date', bookingDate)
        .in('status', ['open', 'assigned', 'confirmed'])
        .order('start_at'),
      supabase.from('bookings').select(BOOKING_SELECT).eq('booking_date', bookingDate).in('status', ['confirmed', 'booked']),
    ])

    const rawShifts = (shiftsRes.data ?? []) as RawShiftRow[]
    const dayBookings = ((bookingsRes.data ?? []) as RawBookingRow[]).map(toMoveBooking)
    const candidate = await candidateFromDayRows(supabase, rawShifts, dayBookings)
    if (!candidate) return 'skipped'

    // Dry-run gate: no ask exists until FareHarbor confirmed the target slot.
    const dryRun = await dryRunCandidate(supabase, bookingDate, candidate)
    if (!dryRun) return 'skipped'

    return await craftAndInsertMoveProposal(supabase, bookingDate, dryRun.candidate, {
      reasoningSuffix: `a new booking just revealed this opportunity; FareHarbor confirmed the ${formatAmsterdamTime(dryRun.candidate.proposedStartAt)} slot`,
      source: 'ghost/guest-move-drafter:new-booking',
      listingSlug: dryRun.listingSlug,
      verdict: dryRun.validated.verdict,
      customerTypeRatePk: dryRun.validated.snap.customerTypeRatePk,
      snappedFromIso: dryRun.snappedFromIso,
    })
  } catch (err) {
    console.error('[ghost/guest_move] new-booking check failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}

/**
 * Send-time re-validation (the execution-chokepoint rule: re-validate
 * immediately before acting). The stored pks were confirmed at draft time,
 * but the human may click hours later — another booking could have taken the
 * slot since. One non-mutating FH validate on the stored pks; the caller
 * blocks the send when it comes back not-bookable.
 */
export async function revalidateStoredMove(payload: {
  verdict?: { checked_avail_pk?: number | null }
  customer_type_rate_pk?: number
  /** Party shape used (and FH-accepted) at draft time: 1 for private, guests for shared. */
  fh_customer_count?: number
}): Promise<DryRunVerdict | null> {
  try {
    const availPk = payload.verdict?.checked_avail_pk
    const ratePk = payload.customer_type_rate_pk
    if (!availPk || !ratePk) return null // pre-dry-run proposal: nothing stored to re-check

    const fh = getFareHarborClient()
    const count = Math.max(1, payload.fh_customer_count ?? 1)
    const validation = await fh.validateBooking(availPk, {
      contact: PLACEHOLDER_CONTACT,
      customers: Array.from({ length: count }, () => ({ customer_type_rate: ratePk })),
      note: 'Ghost dry-run capability check — not a real booking',
    })
    return toVerdict(validation, availPk, new Date().toISOString())
  } catch (err) {
    console.error('[ghost/guest_move] re-validate failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Expiry sweep (runs in the daily ghost-ops cron): a sent request the guest
 * hasn't answered within 48h goes to 'expired' — expiring it unblocks the
 * day's sequential slot, so a fresh (possibly better) ask can be drafted on a
 * later run. Job-queue-grade follow-ups are a later phase.
 */
export async function expireStaleGuestMoves(): Promise<number> {
  try {
    const supabase = createAdminClient()
    const cutoff = new Date(Date.now() - GUEST_MOVE_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()
    const { data } = await supabase
      .from('agent_proposals')
      .select('id, outcome')
      .eq('kind', 'guest_move_request')
      .eq('status', 'approved')
    const stale = (data ?? []).filter(p => {
      const sentAt = (p.outcome as { sent_at?: string } | null)?.sent_at
      return typeof sentAt === 'string' && sentAt < cutoff
    })
    for (const p of stale) {
      await supabase.from('agent_proposals').update({ status: 'expired' }).eq('id', p.id)
      await emitOpsEvent({
        eventType: 'guest_move_expired',
        actorType: 'system',
        proposalId: p.id,
        source: 'ghost/guest-move-drafter:expiry',
      })
    }
    return stale.length
  } catch (err) {
    console.error('[ghost/guest_move] expiry failed:', err instanceof Error ? err.message : err)
    return 0
  }
}
