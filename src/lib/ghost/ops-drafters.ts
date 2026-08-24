import { CLAUDE_DRAFTER_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterCateringItems, hasCatering, isDrinksOnlyBooking, type ExtrasLineItem } from '@/lib/catering/filter'
import { extrasPageUrl } from '@/lib/booking/extras-token'
import { emitOpsEvent } from '@/lib/ops/events'
import { amsterdamToday, formatAmsterdamTime } from '@/lib/utils'
import { autonomyForKind } from './agents'
import { recentScheduleLessons } from './evaluate'
import { applyScheduleAssignments, type ScheduleAssignmentInput } from '@/lib/scheduling/apply-assignments'
import { shiftCostCents, fmtCostEuros } from '@/lib/scheduling/shift-cost'
import { shiftFitsAvailabilityWindow } from '@/lib/scheduling/availability-status'
import {
  SCHEDULE_DAY_PROMPT,
  SCHEDULE_DAY_JSON,
  CATERING_ORDER_PROMPT,
  CATERING_ORDER_JSON,
  CATERING_UPSELL_PROMPT,
  CATERING_UPSELL_JSON,
  CATERING_LOOKAHEAD_DAYS,
  UPSELL_LEAD_DAYS,
} from './rulebook'

/**
 * Ghost ops drafters — shadow proposals for the operations section
 * (vision doc §1: AI reads the truth, writes a proposal, a human decides).
 *
 *   schedule_day     — who should captain a day's open shifts. The one
 *                      exception to "shadow only" below: at 'auto' autonomy
 *                      it assigns for real and DMs the captain immediately
 *                      (see draftOrAssignSchedule) — everything else here
 *                      stays shadow-only.
 *   catering_order   — what to order for upcoming cruises with catering
 *   catering_upsell  — snackbox offer for guests who ONLY booked drinks
 *
 * Same hard rules as the reply drafter: status 'shadow', nothing executes,
 * all errors swallowed, every Claude call metered via recordAiUsage().
 * One proposal per kind per target date (dedupe below) — a re-run cron
 * never doubles up. schedule_day's auto path is the deliberate exception:
 * it skips that dedupe so a fresh booking can open (and fill) a new shift
 * on a date already scanned today — see draftOrAssignSchedule.
 */

type AdminClient = ReturnType<typeof createAdminClient>

/** True if a shadow proposal of this kind already exists for this target date. */
async function proposalExists(supabase: AdminClient, kind: string, targetDate: string): Promise<boolean> {
  const { data } = await supabase
    .from('agent_proposals')
    .select('id')
    .eq('kind', kind)
    .eq('payload->>target_date', targetDate)
    .limit(1)
  return (data?.length ?? 0) > 0
}

export function extractJson(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return null
  }
}

// ── schedule_day — captain assignments for a given date ──────────────────────

interface ScheduleShiftRow {
  id: string
  date: string
  start_at: string
  end_at: string
  status: string
  staff_id: string | null
  boats: { name?: string } | null
  bookings: { listing_title?: string | null; guest_count?: number | null } | null
}

/**
 * Drafts (or, at 'auto' autonomy, directly assigns) captains for every OPEN
 * shift on `targetDate`. Called both by the daily horizon scan and reactively
 * right after a new booking opens a shift — see
 * src/lib/scheduling/proactive-scheduling.ts.
 *
 * Returns 'assigned' when it auto-executed, 'drafted' when it left a shadow
 * proposal for a human, 'skipped' when there was nothing to do (or it
 * couldn't confidently fill anything).
 */
export async function draftOrAssignSchedule(targetDate: string): Promise<'assigned' | 'drafted' | 'skipped'> {
  try {
    const supabase = createAdminClient()
    const auto = autonomyForKind('schedule_day') === 'auto'

    // The shadow-propose path is one-proposal-per-date forever; the auto path
    // deliberately skips this so a booking that opens a NEW shift on a date
    // already scanned today still gets picked up immediately, instead of
    // waiting for tomorrow's cron. Its own idempotency comes from each shift
    // only ever being open once (applyScheduleAssignments' atomic claim).
    if (!auto && (await proposalExists(supabase, 'schedule_day', targetDate))) return 'skipped'

    const { data: shifts } = await supabase
      .from('shifts')
      .select('id, date, start_at, end_at, status, staff_id, boats(name), bookings(listing_title, guest_count)')
      .eq('date', targetDate)
      .in('status', ['open', 'assigned', 'confirmed'])
      .order('start_at')
    const shiftRows = (shifts ?? []) as unknown as ScheduleShiftRow[]
    const openShifts = shiftRows.filter(s => s.status === 'open')
    if (!openShifts.length) return 'skipped' // nothing to schedule = no proposal, no cost

    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, role, max_shifts_per_week, is_active, hourly_rate_cents')
      .eq('is_active', true)
    if (!staff?.length) return 'skipped'

    const { data: availability } = await supabase
      .from('staff_availability')
      .select('staff_id, status, note, start_time, end_time')
      .eq('date', targetDate)

    // Workload last 7 REAL days (not relative to targetDate) — how busy
    // someone actually has been, plus every future shift already on the
    // books (no upper bound), so a captain already loaded up later in the
    // horizon reads as less "free" today too.
    const weekAgo = amsterdamToday(-7)
    const { data: recentShifts } = await supabase
      .from('shifts')
      .select('staff_id')
      .gte('date', weekAgo)
      .not('staff_id', 'is', null)
      .in('status', ['assigned', 'confirmed', 'completed'])

    const workload = new Map<string, number>()
    for (const s of recentShifts ?? []) {
      if (s.staff_id) workload.set(s.staff_id, (workload.get(s.staff_id) ?? 0) + 1)
    }
    const availMap = new Map((availability ?? []).map(a => [a.staff_id, a]))
    const staffById = new Map(staff.map(p => [p.id, p]))

    const staffLines = staff
      .map(p => {
        const a = availMap.get(p.id)
        // start_time/end_time (partly available, Beer, 2026-08-23/24) only
        // ever accompany 'available' — shown so Claude can match a shift's
        // time against them itself, on top of the hard TS check below.
        const hours = a?.start_time && a?.end_time ? ` ${a.start_time.slice(0, 5)}–${a.end_time.slice(0, 5)}` : ''
        return `- ${p.name} (id: ${p.id}, ${p.role}) · availability: ${a?.status ?? 'not stated'}${hours}${a?.note ? ` ("${a.note}")` : ''} · shifts last 7 days: ${workload.get(p.id) ?? 0}${p.max_shifts_per_week ? ` · max/week: ${p.max_shifts_per_week}` : ''} · rate: ${fmtCostEuros(p.hourly_rate_cents)}/h`
      })
      .join('\n')

    const shiftLines = shiftRows
      .map(s => {
        const boat = s.boats?.name ?? '?'
        const booking = s.bookings
        const time = `${new Date(s.start_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })}–${new Date(s.end_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' })}`
        return `- shift ${s.id} · ${boat} · ${time} · ${booking?.listing_title ?? 'manual shift'}${booking?.guest_count ? ` · ${booking.guest_count} guests` : ''} · status: ${s.status}`
      })
      .join('\n')

    const response = await meteredMessage('ghost_schedule_day', {
      model: CLAUDE_DRAFTER_MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `${SCHEDULE_DAY_PROMPT}

TARGET DATE: ${targetDate}

${await recentScheduleLessons(supabase)}STAFF
${staffLines}

THE DATE'S SHIFTS (assign the 'open' ones; already-assigned ones are context for overlap checks)
${shiftLines}

${SCHEDULE_DAY_JSON}`,
        },
      ],
    })

    const parsed = extractJson(firstText(response))
    if (!parsed || !Array.isArray(parsed.assignments)) return 'skipped'

    const rawAssignments = parsed.assignments as { shift_id?: string; staff_id?: string; staff_name?: string; reason?: string }[]
    const openShiftIds = new Set(openShifts.map(s => s.id))
    const shiftById = new Map(shiftRows.map(s => [s.id, s]))

    // Only ever act on a shift that was actually open when we asked — belt
    // and suspenders alongside applyScheduleAssignments' own guard.
    const validAssignments = rawAssignments.filter(
      (a): a is Required<Pick<typeof a, 'shift_id' | 'staff_id'>> & typeof a =>
        !!a.shift_id && !!a.staff_id && openShiftIds.has(a.shift_id) && staffById.has(a.staff_id),
    )
    if (!validAssignments.length) {
      const { error: insertError } = await supabase.from('agent_proposals').insert({
        kind: 'schedule_day',
        payload: { target_date: targetDate, assignments: [] },
        reasoning: typeof parsed.summary === 'string' ? parsed.summary : 'Model returned no valid assignments.',
        status: 'skipped',
        model: CLAUDE_DRAFTER_MODEL,
      })
      if (insertError) throw new Error(`Could not create schedule_day proposal: ${insertError.message}`)
      return 'skipped'
    }

    // Real cost, not the model's arithmetic: derived from the shift's actual
    // duration and the assigned staff member's actual rate.
    const assignments: (ScheduleAssignmentInput & { reason?: string; cost_cents: number })[] = validAssignments.map(a => {
      const shift = shiftById.get(a.shift_id)!
      const person = staffById.get(a.staff_id)!
      return {
        shift_id: a.shift_id,
        staff_id: a.staff_id,
        staff_name: a.staff_name ?? person.name,
        reason: a.reason,
        cost_cents: shiftCostCents(person.hourly_rate_cents, shift.start_at, shift.end_at),
      }
    })

    if (auto) {
      // No human reviews an auto-assignment before it locks in, so the HARD
      // rules from the prompt (never 'unavailable', never outside a stated
      // partly-available window, never double-book one person) are
      // re-checked here rather than trusted — greedily accepting in the
      // order Claude returned them.
      const busyWindows = new Map<string, { start: number; end: number }[]>()
      for (const s of shiftRows) {
        if (s.status === 'open' || !s.staff_id) continue
        const list = busyWindows.get(s.staff_id) ?? []
        list.push({ start: new Date(s.start_at).getTime(), end: new Date(s.end_at).getTime() })
        busyWindows.set(s.staff_id, list)
      }
      const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end

      const safeAssignments: typeof assignments = []
      for (const a of assignments) {
        const avail = availMap.get(a.staff_id)
        if (avail?.status === 'unavailable') continue
        const shift = shiftById.get(a.shift_id)!
        if (avail?.start_time && avail?.end_time) {
          const fits = shiftFitsAvailabilityWindow(
            formatAmsterdamTime(shift.start_at),
            formatAmsterdamTime(shift.end_at),
            avail.start_time.slice(0, 5),
            avail.end_time.slice(0, 5),
          )
          if (!fits) continue // partly available, but this shift falls outside the stated window
        }
        const window = { start: new Date(shift.start_at).getTime(), end: new Date(shift.end_at).getTime() }
        const existing = busyWindows.get(a.staff_id) ?? []
        if (existing.some(w => overlaps(w, window))) continue
        safeAssignments.push(a)
        busyWindows.set(a.staff_id, [...existing, window])
      }
      if (!safeAssignments.length) {
        const { error: insertError } = await supabase.from('agent_proposals').insert({
          kind: 'schedule_day',
          payload: { target_date: targetDate, assignments: [] },
          reasoning:
            typeof parsed.summary === 'string'
              ? `${parsed.summary} (safety net also rejected every proposed assignment.)`
              : 'The safety net rejected every proposed assignment.',
          status: 'skipped',
          model: CLAUDE_DRAFTER_MODEL,
        })
        if (insertError) throw new Error(`Could not create schedule_day proposal: ${insertError.message}`)
        return 'skipped'
      }

      const { applied, skipped } = await applyScheduleAssignments(
        supabase,
        safeAssignments,
        { actorType: 'agent', actorId: 'ops_optimizer', source: 'ghost/schedule_day:auto' },
        // Assign now, DM later: an auto-assignment made days ahead is
        // provisional as more bookings land — the captain hears about it
        // only once Beer confirms (admin/planning/ghost-activity/[id]/confirm),
        // not once here and possibly again as the roster shifts.
        { notify: false },
      )
      if (!applied.length) return 'skipped'

      const { error: insertError } = await supabase.from('agent_proposals').insert({
        kind: 'schedule_day',
        payload: JSON.parse(JSON.stringify({ target_date: targetDate, assignments: safeAssignments })),
        reasoning: typeof parsed.summary === 'string' ? parsed.summary : null,
        status: 'executed',
        model: CLAUDE_DRAFTER_MODEL,
        outcome: JSON.parse(JSON.stringify({ applied_at: new Date().toISOString(), applied, skipped })),
      })
      // The assignments themselves already landed — a failed audit-log insert
      // shouldn't be reported as if nothing happened.
      if (insertError) console.error('[ghost/schedule_day] auto-assigned but failed to log proposal:', insertError.message)
      return 'assigned'
    }

    const { error: insertError } = await supabase.from('agent_proposals').insert({
      kind: 'schedule_day',
      payload: JSON.parse(JSON.stringify({ target_date: targetDate, assignments })),
      reasoning: typeof parsed.summary === 'string' ? parsed.summary : null,
      status: 'shadow',
      model: CLAUDE_DRAFTER_MODEL,
    })
    // A swallowed error here previously still returned 'drafted' — a false
    // positive: no proposal exists to review, but nothing said so.
    if (insertError) throw new Error(`Could not create schedule_day proposal: ${insertError.message}`)
    return 'drafted'
  } catch (err) {
    console.error('[ghost/schedule_day] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}

// ── catering_order — what to order for upcoming cruises ─────────────────────
// (lookahead lives in rulebook.ts, shown on /admin/ghost/rulebook)

export async function draftCateringOrders(): Promise<'drafted' | 'skipped'> {
  try {
    const supabase = createAdminClient()
    const today = amsterdamToday()
    const horizon = amsterdamToday(CATERING_LOOKAHEAD_DAYS)

    if (await proposalExists(supabase, 'catering_order', today)) return 'skipped'

    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, booking_date, start_time, listing_title, guest_count, extras_selected, catering_email_sent_at')
      .in('status', ['confirmed', 'booked'])
      .gte('booking_date', today)
      .lte('booking_date', horizon)
      .order('booking_date')

    const cateringBookings = (bookings ?? []).filter(b => hasCatering(b.extras_selected as ExtrasLineItem[] | null))
    if (!cateringBookings.length) return 'skipped'

    const lines = cateringBookings
      .map(b => {
        const items = filterCateringItems(b.extras_selected as ExtrasLineItem[] | null)
          .map(i => `${i.quantity ?? 1}× ${i.name}${i.is_per_person_pick ? ` (for ${i.quantity} people)` : ''}`)
          .join(', ')
        return `- ${b.booking_date} ${b.start_time ?? ''} · ${b.listing_title ?? 'cruise'} · ${b.guest_count ?? '?'} guests · ${items} · supplier email ${b.catering_email_sent_at ? 'SENT' : 'NOT SENT'}`
      })
      .join('\n')

    const response = await meteredMessage('ghost_catering_order', {
      model: CLAUDE_DRAFTER_MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `${CATERING_ORDER_PROMPT}

BOOKINGS (next ${CATERING_LOOKAHEAD_DAYS} days)
${lines}

${CATERING_ORDER_JSON}`,
        },
      ],
    })

    const parsed = extractJson(firstText(response))
    if (!parsed || !Array.isArray(parsed.orders)) return 'skipped'

    const { error: insertError } = await supabase.from('agent_proposals').insert({
      kind: 'catering_order',
      payload: { target_date: today, orders: parsed.orders },
      reasoning: typeof parsed.summary === 'string' ? parsed.summary : null,
      status: 'shadow',
      model: CLAUDE_DRAFTER_MODEL,
    })
    if (insertError) throw new Error(`Could not create catering_order proposal: ${insertError.message}`)
    return 'drafted'
  } catch (err) {
    console.error('[ghost/catering_order] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}

// ── catering_upsell — snackbox offer for drinks-only bookings ────────────────

/**
 * Guests who booked ONLY the unlimited drinks package sorted their drinks but
 * have nothing to eat aboard — the perfect bites-box audience (Beer
 * 2026-07-04). The Ghost drafts a personal offer email with the guest's
 * existing pre-order page link; a human clicks Approve & send on /admin/ghost.
 * Disjoint from the automated extras-upsell cron, which only mails bookings
 * with ZERO catering — and both stamp extras_upsell_sent_at, so a guest can
 * only ever get one upsell email. (Lead days live in rulebook.ts.)
 */

export async function draftCateringUpsells(): Promise<'drafted' | 'skipped'> {
  try {
    const supabase = createAdminClient()
    const targetDate = amsterdamToday(UPSELL_LEAD_DAYS)

    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, customer_name, customer_email, listing_title, booking_date, start_time, guest_count, extras_selected')
      .eq('booking_date', targetDate)
      .in('status', ['confirmed', 'booked'])
      .is('extras_upsell_sent_at', null)
      .not('customer_email', 'is', null)

    const drinksOnly = (bookings ?? []).filter(b =>
      isDrinksOnlyBooking(b.extras_selected as ExtrasLineItem[] | null),
    )
    if (!drinksOnly.length) return 'skipped'

    // One proposal per booking, ever (re-runs are no-ops).
    const { data: existing } = await supabase
      .from('agent_proposals')
      .select('payload')
      .eq('kind', 'catering_upsell')
      .eq('payload->>target_date', targetDate)
    const alreadyProposed = new Set(
      (existing ?? []).map(p => (p.payload as { booking_id?: string } | null)?.booking_id).filter(Boolean),
    )

    // Ground the email in REAL menu items + prices — never invented.
    const { data: foodExtras } = await supabase
      .from('extras')
      .select('name, description, price_type, price_value')
      .eq('is_active', true)
      .eq('category', 'food')
      .order('sort_order', { ascending: true })
      .limit(3)
    if (!foodExtras?.length) return 'skipped'
    const menuLines = foodExtras
      .map(e => `- ${e.name} · €${Number(e.price_value).toFixed(2)}${e.price_type === 'per_person' ? ' p.p.' : ''}${e.description ? ` · ${e.description}` : ''}`)
      .join('\n')

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
    let drafted = 0

    for (const b of drinksOnly) {
      if (alreadyProposed.has(b.id)) continue

      const orderUrl = extrasPageUrl(b.id, siteUrl)
      const response = await meteredMessage('ghost_catering_upsell', {
        model: CLAUDE_DRAFTER_MODEL,
        max_tokens: 800,
        messages: [
          {
            role: 'user',
            content: `${CATERING_UPSELL_PROMPT}

THE GUEST
- ${b.customer_name ?? 'Guest'} · ${b.listing_title ?? 'cruise'} on ${b.booking_date}${b.start_time ? ` at ${formatAmsterdamTime(b.start_time)}` : ''} · ${b.guest_count ?? '?'} people
- They booked the unlimited drinks package — drinks are sorted, but nothing to eat aboard yet.

THE OFFER — real menu, real prices:
${menuLines}

They pre-order on their personal page (no payment until the day): ${orderUrl}

${CATERING_UPSELL_JSON}`,
          },
        ],
      })

      const parsed = extractJson(firstText(response))
      const emailSubject = typeof parsed?.email_subject === 'string' ? parsed.email_subject : null
      const emailBody = typeof parsed?.email_body === 'string' ? parsed.email_body : null
      if (!emailSubject || !emailBody || !emailBody.includes(orderUrl)) continue

      const { data: inserted } = await supabase
        .from('agent_proposals')
        .insert({
          kind: 'catering_upsell',
          payload: JSON.parse(
            JSON.stringify({
              target_date: targetDate,
              booking_id: b.id,
              guest_name: b.customer_name,
              cruise_title: b.listing_title,
              guest_count: b.guest_count,
              recipient: b.customer_email,
              email_subject: emailSubject,
              email_body: emailBody,
            }),
          ),
          reasoning: `${b.customer_name ?? 'Guest'} (${b.guest_count ?? '?'} p) booked ONLY the unlimited drinks package for ${targetDate} — drinks sorted, nothing to eat. Snackbox offer via their existing pre-order page.`,
          status: 'shadow',
          model: CLAUDE_DRAFTER_MODEL,
        })
        .select('id')
        .single()

      await emitOpsEvent({
        eventType: 'recommendation_created',
        actorType: 'agent',
        actorId: 'catering',
        proposalId: inserted?.id ?? null,
        bookingId: b.id,
        source: 'ghost/catering-upsell',
        payload: { target_date: targetDate },
      })
      drafted++
    }

    return drafted > 0 ? 'drafted' : 'skipped'
  } catch (err) {
    console.error('[ghost/catering_upsell] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}
