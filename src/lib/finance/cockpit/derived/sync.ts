/**
 * The shared upsert behind every derived-obligation auto-sync: city tax,
 * BTW, and standing charges (2026-09-05), alongside skipper-hours' own
 * near-identical function in obligations/derived/skipper-hours/shared.ts
 * (kept separate there since it predates this one and is already reviewed
 * and shipped — no value in touching working code to save one file).
 *
 * Beer, 2026-09-04/05: derived obligations should "go automatically"
 * instead of needing a manual confirm click. This is what makes that safe:
 * idempotent on `source_key`, never overwrites a row that's already 'paid'
 * or 'cancelled', and only writes when the amount actually changed (so a
 * routine nightly re-sync of an unchanged quarter is a silent no-op, not a
 * finance_events entry every night).
 *
 * Deliberately generic over a plain proposal shape rather than tied to one
 * domain's types — city-tax/vat/recurring proposals share nothing but
 * {key, title, kind, amountCents, dueDate, notes} once each domain's own
 * pure `*Obligations()`/`detectRecurring()` function has already turned raw
 * data into a proposal.
 */
import { logFinanceEvent, type FinanceActor } from '@/lib/finance/cockpit/events'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ObligationKind } from '@/lib/finance/cockpit/types'
import type { ISODate } from '@/lib/finance/cockpit/dates'

type Admin = ReturnType<typeof createAdminClient>

export interface DerivedObligationProposal {
  /** The full source_key, e.g. 'city-tax:2026-Q3', 'vat:2026-Q2', or a recurring-charge key. */
  key: string
  title: string
  kind: ObligationKind
  amountCents: number
  dueDate: ISODate
  recurrenceMonths?: 1 | 3 | 6 | 12 | null
  notes: string
}

export interface DerivedObligationSyncResult {
  sourceKey: string
  status: 'created' | 'updated' | 'skipped'
  id?: string
  reason?: string
}

export async function upsertDerivedObligation(supabase: Admin, proposal: DerivedObligationProposal, actor: FinanceActor): Promise<DerivedObligationSyncResult> {
  const { data: existing } = await supabase.from('finance_obligations').select('id, amount_cents, status').eq('source_key', proposal.key).maybeSingle()

  if (existing) {
    if (existing.status !== 'open') return { sourceKey: proposal.key, status: 'skipped', reason: 'al afgehandeld', id: existing.id }
    if (existing.amount_cents === proposal.amountCents) return { sourceKey: proposal.key, status: 'skipped', reason: 'ongewijzigd', id: existing.id }

    // `.eq('status','open')` again at write time: a manual "betaald" click between our read and this write must win.
    const { data: updated, error } = await supabase.from('finance_obligations').update({ amount_cents: proposal.amountCents, notes: proposal.notes }).eq('id', existing.id).eq('status', 'open').select('id')
    if (error) throw new Error(error.message)
    if (!updated || updated.length === 0) return { sourceKey: proposal.key, status: 'skipped', reason: 'inmiddels afgehandeld', id: existing.id }

    await logFinanceEvent(supabase, {
      event_type: 'obligation_updated',
      actor,
      entity_type: 'obligation',
      entity_id: existing.id,
      delta_cents: proposal.amountCents - existing.amount_cents,
      payload: { title: proposal.title, kind: proposal.kind, source_key: proposal.key, reason: 'derived_resync' },
    })
    return { sourceKey: proposal.key, status: 'updated', id: existing.id }
  }

  const { data, error } = await supabase
    .from('finance_obligations')
    .insert({
      title: proposal.title,
      kind: proposal.kind,
      amount_cents: proposal.amountCents,
      due_date: proposal.dueDate,
      recurrence_months: proposal.recurrenceMonths ?? null,
      source_key: proposal.key,
      notes: proposal.notes,
      status: 'open',
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { sourceKey: proposal.key, status: 'skipped', reason: 'already existed' }
    throw new Error(error.message)
  }

  await logFinanceEvent(supabase, {
    event_type: 'obligation_created',
    actor,
    entity_type: 'obligation',
    entity_id: data!.id,
    delta_cents: proposal.amountCents,
    payload: { title: proposal.title, kind: proposal.kind, due_date: proposal.dueDate, source_key: proposal.key },
  })
  return { sourceKey: proposal.key, status: 'created', id: data!.id }
}
