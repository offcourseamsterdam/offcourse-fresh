/**
 * Append-only audit log for every planning change (finance_events).
 *
 * Never throws: an audit-log hiccup must not undo or block the user action it
 * describes. Failures are logged to the console instead.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/lib/supabase/types'

type Admin = SupabaseClient<Database>

export type FinanceActor = 'user' | 'cron' | 'ai' | 'webhook' | 'system'
export type FinanceEntityType = 'settings' | 'obligation' | 'loan' | 'loan_payment' | 'goal' | 'revolut' | 'transaction' | 'classification_rule' | 'invoice' | 'investment'

export interface FinanceEventInput {
  event_type: string
  actor: FinanceActor
  entity_type: FinanceEntityType
  entity_id: string | null
  /** Change in reserved/claimed money this event represents, in cents. Null when not applicable. */
  delta_cents?: number | null
  payload?: Record<string, unknown>
}

export async function logFinanceEvent(supabase: Admin, input: FinanceEventInput): Promise<void> {
  try {
    const { error } = await supabase.from('finance_events').insert({
      event_type: input.event_type,
      actor: input.actor,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      delta_cents: input.delta_cents ?? null,
      payload: (input.payload ?? {}) as Json,
    })
    if (error) console.error('[finance-events] insert failed:', error.message, input.event_type)
  } catch (err) {
    console.error('[finance-events] insert threw:', err, input.event_type)
  }
}

/**
 * Picks the keys whose value differs between two rows — the `changed`,
 * `before`, `after` triple every *_updated event carries.
 */
export function diffChanges<T extends Record<string, unknown>>(
  before: T,
  after: T,
  keys: readonly string[],
): { changed: string[]; before: Record<string, unknown>; after: Record<string, unknown> } {
  const changed: string[] = []
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  for (const k of keys) {
    if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) {
      changed.push(k)
      b[k] = before[k] ?? null
      a[k] = after[k] ?? null
    }
  }
  return { changed, before: b, after: a }
}
