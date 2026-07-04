import { CLAUDE_DRAFTER_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { hasCatering, type ExtrasLineItem } from '@/lib/catering/filter'
import { deriveOperationalProfile } from '@/lib/ops/profile'
import { emitOpsEvent } from '@/lib/ops/events'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { computeDayFacts, type OpsReviewShift } from './ops-review'
import { extractJson } from './ops-drafters'
import {
  MIN_GAP_MINUTES,
  MIN_GAP_SAVING_CENTS,
  OPTIMIZE_HORIZON_DAYS,
  GUEST_MOVE_EXPIRY_HOURS,
  GUEST_MOVE_PROMPT,
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
  listingTitle: string | null
  guestCount: number | null
  totalCents: number | null
  fareharborAvailabilityPk: number | null
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
  'id, booking_date, category, customer_name, customer_email, customer_phone, extras_selected, listing_title, guest_count, receipt_total, base_amount_cents, extras_amount_cents, fareharbor_availability_pk'

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
  listing_title: string | null
  guest_count: number | null
  receipt_total: number | null
  base_amount_cents: number | null
  extras_amount_cents: number | null
  fareharbor_availability_pk: number | null
}

function toMoveBooking(b: RawBookingRow): MoveBooking {
  return {
    id: b.id,
    category: b.category,
    customerName: b.customer_name,
    customerEmail: b.customer_email,
    customerPhone: b.customer_phone,
    extrasSelected: (b.extras_selected as ExtrasLineItem[] | null) ?? null,
    listingTitle: b.listing_title,
    guestCount: b.guest_count,
    totalCents: b.receipt_total ?? (b.base_amount_cents ?? 0) + (b.extras_amount_cents ?? 0),
    fareharborAvailabilityPk: b.fareharbor_availability_pk,
  }
}

/**
 * The core candidate computation, shared by the nightly horizon scan and the
 * new-booking trigger — both end up with the same shape of raw rows for a
 * single day, just fetched differently (one big batched query vs. one
 * targeted single-day query).
 */
function candidateFromDayRows(rawShifts: RawShiftRow[], dayBookings: MoveBooking[]): MoveCandidate | null {
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
      bookingId: s.booking_id,
      availabilityPk: s.fareharbor_availability_pk,
    }
  })

  return selectMoveCandidate(shifts, bookingsById, bookingsByAvailPk)
}

/** Sequential invariant: any not-yet-settled move request blocks a new one for that date. */
async function openMoveRequestExists(supabase: AdminClient, targetDate: string): Promise<boolean> {
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
 * Claude drafts the SMS + email, then the shadow proposal is written and
 * logged. Shared by the nightly scan and the new-booking trigger — the only
 * difference between them is HOW a candidate + reasoning suffix were found,
 * never how the ask itself gets drafted.
 */
async function craftAndInsertMoveProposal(
  supabase: AdminClient,
  targetDate: string,
  candidate: MoveCandidate,
  opts: { reasoningSuffix: string; source: string },
): Promise<'drafted' | 'skipped'> {
  const currentTime = formatAmsterdamTime(candidate.currentStartAt)
  const proposedTime = formatAmsterdamTime(candidate.proposedStartAt)
  const totalEur = ((candidate.booking.totalCents ?? 0) / 100).toFixed(2)

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

Return JSON only:
{"sms_text": "<SMS incl {{link}}>", "email_subject": "<subject>", "email_body": "<plain-text email incl {{link}}, with a one-line summary of their booking (date, time ${currentTime} → ${proposedTime}, party size, price unchanged €${totalEur})>"}`,
      },
    ],
  })

  const parsed = extractJson(firstText(response))
  const smsText = typeof parsed?.sms_text === 'string' ? parsed.sms_text : null
  const emailSubject = typeof parsed?.email_subject === 'string' ? parsed.email_subject : null
  const emailBody = typeof parsed?.email_body === 'string' ? parsed.email_body : null
  if (!smsText || !emailSubject || !emailBody) return 'skipped'
  if (!smsText.includes('{{link}}') || !emailBody.includes('{{link}}')) return 'skipped'

  const { data: inserted } = await supabase
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
          incentive: 'a bottle of wine on the house',
          sms_text: smsText,
          email_subject: emailSubject,
          email_body: emailBody,
        }),
      ),
      reasoning: `Closing the ${candidate.gapMinutes} min gap on ${candidate.boat} (${targetDate}) saves ≈ €${(candidate.estSavingCents / 100).toFixed(2)} in paid waiting — ${opts.reasoningSuffix}. No catering aboard, single-party departure — safe to ask. Sequential: this is the only open ask for ${targetDate}.`,
      status: 'shadow',
      model: CLAUDE_DRAFTER_MODEL,
    })
    .select('id')
    .single()

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
      const candidate = candidateFromDayRows(rawShifts, bookingsByDate.get(date) ?? [])
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

    return await craftAndInsertMoveProposal(supabase, picked.date, picked.candidate, {
      reasoningSuffix: `the best opportunity in the next ${OPTIMIZE_HORIZON_DAYS} days`,
      source: 'ghost/guest-move-drafter:nightly',
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
    const candidate = candidateFromDayRows(rawShifts, dayBookings)
    if (!candidate) return 'skipped'

    return await craftAndInsertMoveProposal(supabase, bookingDate, candidate, {
      reasoningSuffix: 'a new booking just revealed this opportunity',
      source: 'ghost/guest-move-drafter:new-booking',
    })
  } catch (err) {
    console.error('[ghost/guest_move] new-booking check failed:', err instanceof Error ? err.message : err)
    return 'skipped'
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
