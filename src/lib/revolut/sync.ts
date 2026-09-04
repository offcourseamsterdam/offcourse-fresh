/**
 * Pull the balance and recent transactions from Revolut into our tables.
 *
 * - Balance → revolut_balance_snapshots (this is "cleared cash").
 * - Transactions → bank_transactions, upserted on revolut_id. Only feed columns
 *   are written, so classification done by Phase 3 (or by Beer) is never
 *   overwritten by a later sync.
 * - Look-back window: last_sync_at − 7 days, so state changes on older
 *   transactions (pending → completed, reverted) are picked up even if a
 *   webhook was missed. First sync: 90 days.
 *
 * Pure helpers (mapTransaction, pendingSums, pickAccount) are exported for tests;
 * syncRevolut() is the orchestration.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { ownLeg, toCents, type RevolutAccount, type RevolutClient, type RevolutTransaction } from './client'

type Admin = SupabaseClient<Database>
type BankTxInsert = Database['public']['Tables']['bank_transactions']['Insert']

export const PENDING_STATES = new Set(['created', 'pending'])
const LOOKBACK_DAYS = 7
const FIRST_SYNC_DAYS = 90

export function pickAccount(accounts: RevolutAccount[], preferredId: string | null | undefined): RevolutAccount | null {
  if (preferredId) {
    const a = accounts.find(x => x.id === preferredId)
    if (a) return a
  }
  const eur = accounts.filter(a => a.currency === 'EUR' && a.state === 'active')
  // Prefer the main (non-pocket) current account when Revolut tells us the type.
  return eur.find(a => a.account_type === 'current') ?? eur[0] ?? null
}

export function mapTransaction(tx: RevolutTransaction, accountId: string, syncedAt: string): BankTxInsert | null {
  const leg = ownLeg(tx, accountId)
  if (!leg) return null
  // Transactions with no leg on our account (e.g. between two other pockets) are not ours.
  if (leg.account_id !== accountId) return null
  return {
    revolut_id: tx.id,
    request_id: tx.request_id ?? null,
    type: tx.type,
    state: tx.state,
    created_at: tx.created_at,
    updated_at: tx.updated_at,
    completed_at: tx.completed_at ?? null,
    account_id: leg.account_id,
    amount_cents: toCents(leg.amount),
    fee_cents: toCents(leg.fee),
    currency: leg.currency,
    balance_after_cents: typeof leg.balance === 'number' ? toCents(leg.balance) : null,
    reference: tx.reference ?? null,
    description: leg.description ?? tx.merchant?.name ?? null,
    counterparty: leg.counterparty ? (leg.counterparty as unknown as BankTxInsert['counterparty']) : null,
    merchant: tx.merchant ? (tx.merchant as unknown as BankTxInsert['merchant']) : null,
    raw: tx as unknown as BankTxInsert['raw'],
    last_synced_at: syncedAt,
  }
}

export function pendingSums(rows: Array<{ state: string; amount_cents: number }>): { pendingOutCents: number; pendingInCents: number } {
  let out = 0, inn = 0
  for (const r of rows) {
    if (!PENDING_STATES.has(r.state)) continue
    if (r.amount_cents < 0) out += -r.amount_cents
    else inn += r.amount_cents
  }
  return { pendingOutCents: out, pendingInCents: inn }
}

export interface SyncResult {
  ok: boolean
  skipped?: 'not_connected' | 'no_account'
  accountId?: string
  balanceCents?: number
  fetched: number
  upserted: number
  stateChanges: Array<{ revolutId: string; from: string | null; to: string }>
  error?: string
}

export async function syncRevolut(supabase: Admin, client: RevolutClient, opts: { now?: Date } = {}): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  const syncedAt = now.toISOString()
  const { data: conn, error: connErr } = await supabase.from('revolut_connection').select('*').eq('id', 'default').maybeSingle()
  if (connErr) throw new Error(connErr.message)
  if (!conn || !conn.refresh_token_enc) return { ok: true, skipped: 'not_connected', fetched: 0, upserted: 0, stateChanges: [] }

  try {
    const accounts = await client.getAccounts()
    const account = pickAccount(accounts, conn.account_id)
    if (!account) return { ok: true, skipped: 'no_account', fetched: 0, upserted: 0, stateChanges: [] }
    const balanceCents = toCents(account.balance)

    const { error: snapErr } = await supabase.from('revolut_balance_snapshots').insert({
      taken_at: syncedAt,
      account_id: account.id,
      balance_cents: balanceCents,
      currency: account.currency,
      source: 'sync',
    })
    if (snapErr) throw new Error(snapErr.message)

    const fromDate = conn.last_sync_at
      ? new Date(new Date(conn.last_sync_at).getTime() - LOOKBACK_DAYS * 86_400_000)
      : new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000)
    const txs = await client.listTransactionsSince(fromDate.toISOString(), undefined, { account: account.id })

    const rows = txs.map(t => mapTransaction(t, account.id, syncedAt)).filter((r): r is BankTxInsert => r !== null)

    // Detect state changes before writing, so Phase 3 can react to pending → completed.
    const ids = rows.map(r => r.revolut_id)
    const prevById = new Map<string, string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data: prev } = await supabase.from('bank_transactions').select('revolut_id, state').in('revolut_id', ids.slice(i, i + 200))
      for (const p of prev ?? []) prevById.set(p.revolut_id, p.state)
    }
    const stateChanges = rows
      .filter(r => prevById.get(r.revolut_id) !== r.state)
      .map(r => ({ revolutId: r.revolut_id, from: prevById.get(r.revolut_id) ?? null, to: r.state }))

    let upserted = 0
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200)
      const { error: upErr } = await supabase.from('bank_transactions').upsert(chunk, { onConflict: 'revolut_id' })
      if (upErr) throw new Error(upErr.message)
      upserted += chunk.length
    }

    const { error: updErr } = await supabase
      .from('revolut_connection')
      .update({ account_id: account.id, account_name: account.name ?? null, last_sync_at: syncedAt, last_sync_error: null, updated_at: syncedAt })
      .eq('id', 'default')
    if (updErr) throw new Error(updErr.message)

    return { ok: true, accountId: account.id, balanceCents, fetched: txs.length, upserted, stateChanges }
  } catch (err) {
    const message = (err as Error).message
    await supabase.from('revolut_connection').update({ last_sync_error: message, updated_at: syncedAt }).eq('id', 'default')
    return { ok: false, fetched: 0, upserted: 0, stateChanges: [], error: message }
  }
}
