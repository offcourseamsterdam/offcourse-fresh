/**
 * Shared loader for the skipper-hours derived-obligation routes (GET/POST here
 * and GET .../payout-run). Not a route file itself — Next.js only treats
 * `route.ts` as an endpoint, so this plain module lives alongside them safely.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { SkipperBonus, SkipperMonthAccrual, SkipperRate, SkipperShift, SkipperTimeEntry } from '@/lib/finance/cockpit/derived/skipper-hours'
import { logFinanceEvent, type FinanceActor } from '@/lib/finance/cockpit/events'

type Admin = SupabaseClient<Database>

export interface SkipperAccrualInputs {
  shifts: SkipperShift[]
  timeEntries: SkipperTimeEntry[]
  bonuses: SkipperBonus[]
  staff: SkipperRate[]
}

/**
 * Loads everything accrueSkipperHours() needs for shifts/entries/bonuses from
 * `since` onward, plus every staff member (for names and current rates).
 *
 * Two bonus tables feed the same `bonuses` list: extra_hours_bonuses (upsell
 * commissions + manual bonuses, see scheduling/payroll) and review_bonuses
 * (the €5 a skipper earns when a 5-star review names them, see
 * scheduling/review-bonuses.ts). Both are money we owe the skipper at the
 * month's payout, so both belong in what the cockpit shows as owed — the
 * review bonus used to be missing here (2026-09-04 review). Rows a human
 * excluded from payroll are skipped, same as PayrollTab does.
 */
export async function loadSkipperAccrualInputs(supabase: Admin, since: string): Promise<SkipperAccrualInputs> {
  const [shiftsRes, timeEntriesRes, bonusesRes, reviewBonusesRes, staffRes] = await Promise.all([
    supabase.from('shifts').select('id, staff_id, date, start_at, end_at, status').gte('date', since),
    supabase.from('time_entries').select('id, staff_id, shift_id, clock_in_at, clock_out_at, hourly_rate_cents').gte('clock_in_at', since),
    supabase.from('extra_hours_bonuses').select('id, staff_id, date, commission_cents').gte('date', since),
    supabase.from('review_bonuses').select('id, staff_id, amount_cents, awarded_at, excluded_from_payroll').gte('awarded_at', since),
    supabase.from('staff').select('id, name, hourly_rate_cents, is_active'),
  ])
  if (shiftsRes.error) throw new Error(shiftsRes.error.message)
  if (timeEntriesRes.error) throw new Error(timeEntriesRes.error.message)
  if (bonusesRes.error) throw new Error(bonusesRes.error.message)
  if (reviewBonusesRes.error) throw new Error(reviewBonusesRes.error.message)
  if (staffRes.error) throw new Error(staffRes.error.message)

  const reviewBonuses: SkipperBonus[] = (reviewBonusesRes.data ?? [])
    .filter(b => !b.excluded_from_payroll)
    .map(b => ({ id: b.id, staffId: b.staff_id, date: b.awarded_at.slice(0, 10), commissionCents: b.amount_cents, note: 'review' }))

  return {
    shifts: (shiftsRes.data ?? []).map(s => ({ id: s.id, staffId: s.staff_id, date: s.date, startAt: s.start_at, endAt: s.end_at, status: s.status })),
    timeEntries: (timeEntriesRes.data ?? []).map(e => ({
      id: e.id, staffId: e.staff_id, shiftId: e.shift_id, clockInAt: e.clock_in_at, clockOutAt: e.clock_out_at, hourlyRateCents: e.hourly_rate_cents,
    })),
    bonuses: [
      ...(bonusesRes.data ?? []).map(b => ({ id: b.id, staffId: b.staff_id, date: b.date, commissionCents: b.commission_cents })),
      ...reviewBonuses,
    ],
    staff: (staffRes.data ?? []).map(s => ({ id: s.id, name: s.name, hourlyRateCents: s.hourly_rate_cents, isActive: s.is_active })),
  }
}

export interface SkipperAccrualUpsertResult {
  sourceKey: string
  status: 'created' | 'updated' | 'skipped'
  id?: string
  reason?: string
}

const NOTE = (accrual: SkipperMonthAccrual) => `Automatisch berekend uit shifts en geklokte uren (${accrual.hours} uur).`

/**
 * Turns one live accrual into (or keeps in sync with) a real finance_obligations
 * row (kind='crew'), keyed on the idempotent source_key
 * `skipper-hours:{month}:{staffId}` — shared by the manual "Bevestigen" button
 * (POST below, actor='user') and the daily auto-sync cron (actor='cron', see
 * cron/finance-sync-skipper-accrual). Beer, 2026-09-04: "the obligation
 * should go automatically... I don't need to confirm a specific month for a
 * specific skipper to make it real" — this function is what makes that safe
 * to automate rather than only reachable by hand:
 *
 *  - Unpriced hours are never paid at zero — skipped with a reason, same as
 *    before automation existed.
 *  - A row that's already 'paid', 'cancelled', or reduced/closed by
 *    supersedeCrewAccrual (an approved skipper invoice) is never touched —
 *    a nightly re-sync must not resurrect or overwrite a settled month.
 *  - An existing open row only gets a DB write when the amount actually
 *    changed (a late-corrected shift, say) — no-op, not "updated", when it
 *    hasn't, so a routine daily run doesn't spam finance_events.
 */
export async function upsertSkipperAccrualObligation(
  supabase: Admin,
  accrual: SkipperMonthAccrual,
  actor: FinanceActor,
): Promise<SkipperAccrualUpsertResult> {
  const sourceKey = `skipper-hours:${accrual.month}:${accrual.staffId}`

  if (accrual.unpricedHours > 0) {
    return { sourceKey, status: 'skipped', reason: `${accrual.unpricedHours} uur zonder uurtarief — stel eerst een uurtarief in` }
  }

  const { data: existing } = await supabase.from('finance_obligations').select('id, amount_cents, status').eq('source_key', sourceKey).maybeSingle()

  if (existing) {
    if (existing.status !== 'open') return { sourceKey, status: 'skipped', reason: 'al afgehandeld of vervangen door een factuur', id: existing.id }
    if (existing.amount_cents === accrual.amountCents) return { sourceKey, status: 'skipped', reason: 'ongewijzigd', id: existing.id }

    const { error } = await supabase.from('finance_obligations').update({ amount_cents: accrual.amountCents, notes: NOTE(accrual) }).eq('id', existing.id)
    if (error) throw new Error(error.message)

    await logFinanceEvent(supabase, {
      event_type: 'obligation_updated',
      actor,
      entity_type: 'obligation',
      entity_id: existing.id,
      delta_cents: accrual.amountCents - existing.amount_cents,
      payload: { title: `${accrual.staffName} — uren ${accrual.month}`, kind: 'crew', source_key: sourceKey, reason: 'accrual_resync' },
    })
    return { sourceKey, status: 'updated', id: existing.id }
  }

  const { data, error } = await supabase
    .from('finance_obligations')
    .insert({
      title: `${accrual.staffName} — uren ${accrual.month}`,
      kind: 'crew',
      amount_cents: accrual.amountCents,
      due_date: accrual.dueDate,
      source_key: sourceKey,
      notes: NOTE(accrual),
      status: 'open',
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { sourceKey, status: 'skipped', reason: 'already existed' }
    throw new Error(error.message)
  }

  await logFinanceEvent(supabase, {
    event_type: 'obligation_created',
    actor,
    entity_type: 'obligation',
    entity_id: data!.id,
    delta_cents: accrual.amountCents,
    payload: { title: `${accrual.staffName} — uren ${accrual.month}`, kind: 'crew', due_date: accrual.dueDate, source_key: sourceKey },
  })
  return { sourceKey, status: 'created', id: data!.id }
}
