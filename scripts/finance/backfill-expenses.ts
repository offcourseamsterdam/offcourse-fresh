#!/usr/bin/env -S npx tsx
/**
 * backfill-expenses.ts — one-time creation of Expense Records for the completed
 * outgoing Revolut transactions that predate the Finance Inbox v2 sync step
 * (plan §3.1, decision 5: 90 days). After this, the 15-minute cron keeps up.
 *
 * Idempotent: only transactions with no expense_id are touched, and the unique
 * index on finance_expenses.bank_transaction_id makes a re-run a no-op.
 *
 * Dry-run by default. Usage (from the worktree root, with a real .env.local):
 *   npx tsx scripts/finance/backfill-expenses.ts               # counts + a sample, writes nothing
 *   npx tsx scripts/finance/backfill-expenses.ts --live        # creates the records
 *   npx tsx scripts/finance/backfill-expenses.ts --days 30     # narrower window
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/supabase/types'
import { ensureExpensesForTransactions } from '../../src/lib/finance/expenses/sync-revolut'

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const key = t.slice(0, eq).trim()
      const val = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { /* rely on process.env */ }
}
loadEnv()

const LIVE = process.argv.includes('--live')
const daysArg = process.argv.indexOf('--days')
const DAYS = daysArg !== -1 ? Number(process.argv[daysArg + 1]) : 90

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  const { data: conn } = await supabase.from('revolut_connection').select('account_id').eq('id', 'default').maybeSingle()
  if (!conn?.account_id) throw new Error('No Revolut account selected in revolut_connection')
  const since = new Date(Date.now() - DAYS * 86_400_000).toISOString()

  const { count } = await supabase
    .from('bank_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', conn.account_id)
    .eq('state', 'completed')
    .lt('amount_cents', 0)
    .is('expense_id', null)
    .gte('created_at', since)
  console.log(`Window: last ${DAYS} days (since ${since.slice(0, 10)}), account ${conn.account_id}`)
  console.log(`Completed outgoing transactions without an expense record: ${count ?? 0}`)

  if (!LIVE) {
    const { data: sample } = await supabase
      .from('bank_transactions')
      .select('created_at, amount_cents, description, type')
      .eq('account_id', conn.account_id)
      .eq('state', 'completed')
      .lt('amount_cents', 0)
      .is('expense_id', null)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(10)
    for (const s of sample ?? []) console.log(`  ${s.created_at.slice(0, 10)}  ${String(s.amount_cents / 100).padStart(10)}  ${s.type.padEnd(14)} ${s.description ?? ''}`)
    console.log('\nDry run — nothing written. Re-run with --live to create the records.')
    return
  }

  // Loop in pages: ensureExpensesForTransactions caps one call at 500 rows.
  let total = { scanned: 0, created: 0, ignored: 0 }
  for (;;) {
    const r = await ensureExpensesForTransactions(supabase as never, { accountId: conn.account_id, since, limit: 500 })
    total = { scanned: total.scanned + r.scanned, created: total.created + r.created, ignored: total.ignored + r.ignored }
    if (r.scanned < 500) break
  }
  console.log(`Done: ${total.created} expense records created, ${total.ignored} recorded as ignored (transfers/fees), ${total.scanned} scanned.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
