#!/usr/bin/env -S npx tsx
/**
 * seed-loans.ts — one-time import of the six investor loans from the Investment
 * Tracker export (~/Downloads/loancashflowexport.md, pulled 2026-09-04) into
 * finance_loans + finance_loan_payments.
 *
 * Idempotent: a loan whose lender_name already exists is skipped. Periods that
 * fell before today are marked paid (they were settled through the tracker);
 * everything from today on stays open and shows up as an obligation.
 *
 * Dry-run by default. Usage (from the worktree root, with a real .env.local):
 *   npx tsx scripts/finance/seed-loans.ts          # prints what would happen
 *   npx tsx scripts/finance/seed-loans.ts --live   # writes
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/supabase/types'
import { materializeLoanSchedule } from '../../src/lib/finance/cockpit/loans/materialize'
import { buildSchedule, type LoanTerms } from '../../src/lib/finance/cockpit/loans/schedule'

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
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })

interface SeedLoan extends LoanTerms {
  name: string
  lenderName: string
}

// Straight from the export, Part 2. All 6.0%, linear.
const LOANS: SeedLoan[] = [
  { name: 'Lening Tijs Louman', lenderName: 'Tijs Louman', principalCents: 600000, interestRatePct: 6, durationYears: 2, interestFreeYears: 2, repaymentType: 'linear', startDate: '2025-05-25' },
  { name: 'Lening Jelka Wittebol', lenderName: 'Jelka Wittebol', principalCents: 300000, interestRatePct: 6, durationYears: 5, interestFreeYears: 2, repaymentType: 'linear', startDate: '2025-06-01' },
  { name: 'Lening Irma Blackmore', lenderName: 'Irma Blackmore', principalCents: 3000000, interestRatePct: 6, durationYears: 10, interestFreeYears: 10, repaymentType: 'linear', startDate: '2025-06-11' },
  { name: 'Lening Erik Musegaas', lenderName: 'Erik Musegaas', principalCents: 8312500, interestRatePct: 6, durationYears: 5, interestFreeYears: 2, repaymentType: 'linear', startDate: '2026-04-01' },
  { name: 'Lening Expres Wijn B.V.', lenderName: 'Expres Wijn B.V.', principalCents: 6000000, interestRatePct: 6, durationYears: 5, interestFreeYears: 2, repaymentType: 'linear', startDate: '2026-03-02' },
  {
    name: 'Lening Enrico Erkelens', lenderName: 'Enrico Erkelens', principalCents: 3000000, interestRatePct: 6, durationYears: 5, interestFreeYears: 2, repaymentType: 'linear', startDate: '2025-09-25',
    tranches: [
      { amountCents: 1000000, date: '2025-09-25', note: 'Tranche 1' },
      { amountCents: 2000000, date: '2026-03-05', note: 'Tranche 2' },
    ],
  },
]

const eur = (c: number) => `€${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(c / 100))}`

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing')
  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } })

  console.log(`${LIVE ? 'LIVE' : 'DRY RUN'} — today ${TODAY}\n`)

  const { data: existing, error } = await supabase.from('finance_loans').select('id, lender_name')
  if (error) throw new Error(error.message)
  const have = new Map((existing ?? []).map(r => [r.lender_name, r.id]))

  for (const loan of LOANS) {
    const schedule = buildSchedule(loan)
    const upcoming = schedule.periods.filter(p => p.dueDate >= TODAY).slice(0, 3)
    const past = schedule.periods.filter(p => p.dueDate < TODAY).length
    console.log(`${loan.name}: ${eur(loan.principalCents)} · ${schedule.periods.length} periods · ends ${schedule.endDate} · ${past} past (→ paid)`)
    for (const p of upcoming) console.log(`   ${p.dueDate}  rente ${eur(p.interestCents).padStart(9)}  aflossing ${eur(p.principalCents).padStart(9)}  totaal ${eur(p.totalCents)}`)

    if (have.has(loan.lenderName)) { console.log('   ↳ already exists, skipped\n'); continue }
    if (!LIVE) { console.log('   ↳ would insert\n'); continue }

    const { data: row, error: insErr } = await supabase
      .from('finance_loans')
      .insert({
        name: loan.name,
        lender_name: loan.lenderName,
        principal_cents: loan.principalCents,
        interest_rate_pct: loan.interestRatePct,
        duration_years: loan.durationYears,
        interest_free_years: loan.interestFreeYears,
        repayment_type: loan.repaymentType,
        start_date: loan.startDate,
        tranches: (loan.tranches ?? []).map(t => ({ amount_cents: t.amountCents, date: t.date, note: t.note ?? null })),
        notes: 'Geïmporteerd uit Investment Tracker export 2026-09-04',
      })
      .select('id')
      .single()
    if (insErr || !row) throw new Error(insErr?.message ?? 'insert failed')

    const m = await materializeLoanSchedule(supabase, row.id)
    const { error: paidErr, count } = await supabase
      .from('finance_loan_payments')
      .update({ is_paid: true, paid_at: new Date().toISOString() }, { count: 'exact' })
      .eq('loan_id', row.id)
      .lt('due_date', TODAY)
    if (paidErr) throw new Error(paidErr.message)
    await supabase.from('finance_events').insert({
      event_type: 'loan_created',
      actor: 'system',
      entity_type: 'loan',
      entity_id: row.id,
      payload: { source: 'seed-loans.ts', periods: m.inserted, markedPaid: count ?? 0 },
    })
    console.log(`   ↳ inserted ${row.id}: ${m.inserted} periods, ${count ?? 0} marked paid\n`)
  }

  // Portfolio view of what the dashboard will deduct per horizon.
  const all = LOANS.flatMap(l => buildSchedule(l).periods.filter(p => p.dueDate >= TODAY))
  const byDate = new Map<string, number>()
  for (const p of all) byDate.set(p.dueDate, (byDate.get(p.dueDate) ?? 0) + p.totalCents)
  console.log('Upcoming across all loans:')
  for (const [d, c] of [...byDate.entries()].sort().slice(0, 4)) console.log(`   ${d}  ${eur(c)}`)
}

main().catch(e => { console.error(e); process.exit(1) })
