import { CLAUDE_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { filterCateringItems, hasCatering, type ExtrasLineItem } from '@/lib/catering/filter'
import { amsterdamToday } from '@/lib/utils'

/**
 * Ghost ops drafters — shadow proposals for the operations section
 * (vision doc §1: AI reads the truth, writes a proposal, a human decides).
 *
 *   schedule_day     — who should captain tomorrow's open shifts
 *   catering_order   — what to order for upcoming cruises with catering
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

function extractJson(raw: string): Record<string, unknown> | null {
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
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `You are the shadow scheduling assistant for Off Course Amsterdam (electric canal boats). Propose a captain for each OPEN shift tomorrow (${tomorrow}). This is a SHADOW proposal — it is logged for comparison against what the human scheduler actually does; nothing is assigned.

RULES
- Never propose someone whose availability is 'unavailable'.
- Treat 'prefer_not' as a last resort and say so in the reason.
- One person cannot be on two overlapping shifts.
- Prefer spreading work fairly (look at shifts last 7 days).

STAFF
${staffLines}

TOMORROW'S SHIFTS (assign the 'open' ones; already-assigned ones are context for overlap checks)
${shiftLines}

Return JSON only:
{"assignments": [{"shift_id": "<id>", "staff_id": "<id>", "staff_name": "<name>", "reason": "<short why>"}], "summary": "<1-2 sentences in English on the overall reasoning, including anything you could not solve>"}`,
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
      model: CLAUDE_MODEL,
    })
    return 'drafted'
  } catch (err) {
    console.error('[ghost/schedule_day] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}

// ── catering_order — what to order for upcoming cruises ─────────────────────

const CATERING_LOOKAHEAD_DAYS = 3

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
      model: CLAUDE_MODEL,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `You are the shadow catering assistant for Off Course Amsterdam. Below are the cruises in the next ${CATERING_LOOKAHEAD_DAYS} days that include catering (food/drinks extras, ordered from supplier Pure Boats by email). This is a SHADOW proposal — logged for comparison, nothing is sent.

Draft the consolidated supplier order: per day, the combined items and quantities, and flag any booking whose supplier email is still NOT SENT (those are the urgent ones).

BOOKINGS
${lines}

Return JSON only:
{"orders": [{"date": "YYYY-MM-DD", "items": [{"name": "<item>", "quantity": <n>}], "urgent_unsent": <count>}], "summary": "<1-2 sentences in English: what to order, what is urgent>"}`,
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
      model: CLAUDE_MODEL,
    })
    return 'drafted'
  } catch (err) {
    console.error('[ghost/catering_order] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}
