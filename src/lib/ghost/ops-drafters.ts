import { CLAUDE_DRAFTER_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterCateringItems, hasCatering, isDrinksOnlyBooking, type ExtrasLineItem } from '@/lib/catering/filter'
import { extrasPageUrl } from '@/lib/booking/extras-token'
import { emitOpsEvent } from '@/lib/ops/events'
import { amsterdamToday, formatAmsterdamTime } from '@/lib/utils'
import { recentScheduleLessons } from './evaluate'
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
 *   schedule_day     — who should captain tomorrow's open shifts
 *   catering_order   — what to order for upcoming cruises with catering
 *   catering_upsell  — snackbox offer for guests who ONLY booked drinks
 *
 * Same hard rules as the reply drafter: status 'shadow', nothing executes,
 * all errors swallowed, every Claude call metered via recordAiUsage().
 * One proposal per kind per target date (dedupe below) — a re-run cron
 * never doubles up.
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

// ── schedule_day — tomorrow's captain assignments ────────────────────────────

export async function draftTomorrowSchedule(): Promise<'drafted' | 'skipped'> {
  try {
    const supabase = createAdminClient()
    const tomorrow = amsterdamToday(1)

    if (await proposalExists(supabase, 'schedule_day', tomorrow)) return 'skipped'

    const { data: shifts } = await supabase
      .from('shifts')
      .select('id, date, start_at, end_at, status, staff_id, boats(name), bookings(listing_title, guest_count)')
      .eq('date', tomorrow)
      .in('status', ['open', 'assigned', 'confirmed'])
      .order('start_at')
    const openShifts = (shifts ?? []).filter(s => s.status === 'open')
    if (!openShifts.length) return 'skipped' // nothing to schedule = no proposal, no cost

    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, role, max_shifts_per_week, is_active')
      .eq('is_active', true)
    if (!staff?.length) return 'skipped'

    const { data: availability } = await supabase
      .from('staff_availability')
      .select('staff_id, status, note')
      .eq('date', tomorrow)

    // Workload last 7 days — the fairness signal.
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

    const staffLines = staff
      .map(p => {
        const a = availMap.get(p.id)
        return `- ${p.name} (id: ${p.id}, ${p.role}) · availability tomorrow: ${a?.status ?? 'not stated'}${a?.note ? ` ("${a.note}")` : ''} · shifts last 7 days: ${workload.get(p.id) ?? 0}${p.max_shifts_per_week ? ` · max/week: ${p.max_shifts_per_week}` : ''}`
      })
      .join('\n')

    const shiftLines = (shifts ?? [])
      .map(s => {
        const boat = (s.boats as { name?: string } | null)?.name ?? '?'
        const booking = s.bookings as { listing_title?: string | null; guest_count?: number | null } | null
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

TARGET DATE: ${tomorrow}

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

    await supabase.from('agent_proposals').insert({
      kind: 'schedule_day',
      payload: { target_date: tomorrow, assignments: parsed.assignments },
      reasoning: typeof parsed.summary === 'string' ? parsed.summary : null,
      status: 'shadow',
      model: CLAUDE_DRAFTER_MODEL,
    })
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

    await supabase.from('agent_proposals').insert({
      kind: 'catering_order',
      payload: { target_date: today, orders: parsed.orders },
      reasoning: typeof parsed.summary === 'string' ? parsed.summary : null,
      status: 'shadow',
      model: CLAUDE_DRAFTER_MODEL,
    })
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
