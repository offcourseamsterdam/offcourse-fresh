import 'server-only'

/**
 * Turns the synced Revolut data into the cockpit's CashInput: the latest
 * balance snapshot is cleared cash; pending transactions are reported
 * separately and never enter the formula.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { CashInput } from '@/lib/finance/cockpit/types'
import { pendingSums } from './sync'

type Admin = SupabaseClient<Database>

export async function getRevolutCashInput(supabase: Admin): Promise<CashInput | null> {
  const { data: conn } = await supabase.from('revolut_connection').select('account_id, refresh_token_enc, last_sync_at').eq('id', 'default').maybeSingle()
  if (!conn?.refresh_token_enc || !conn.account_id) return null

  const { data: snap } = await supabase
    .from('revolut_balance_snapshots')
    .select('balance_cents, taken_at')
    .eq('account_id', conn.account_id)
    .order('taken_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!snap) return null

  const { data: pending } = await supabase
    .from('bank_transactions')
    .select('state, amount_cents')
    .eq('account_id', conn.account_id)
    .in('state', ['created', 'pending'])
  const sums = pendingSums(pending ?? [])

  return {
    clearedCents: snap.balance_cents,
    pendingOutCents: sums.pendingOutCents,
    pendingInCents: sums.pendingInCents,
    source: 'revolut',
    asOf: snap.taken_at,
  }
}
