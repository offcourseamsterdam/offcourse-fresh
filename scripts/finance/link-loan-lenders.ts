#!/usr/bin/env -S npx tsx
/**
 * link-loan-lenders.ts — one-time: gives each lender in finance_loans a payee (a finance_suppliers
 * row with their IBAN) so the interest cron can draft payments to them.
 *
 * The IBANs come from interest payments Beer already made by hand, as they appear in a Revolut
 * account-statement CSV export — so no IBAN is ever typed into, or committed to, this repo.
 *
 * Dry-run by default; IBANs are printed masked. Usage (from the worktree root, with a real .env.local):
 *   npx tsx scripts/finance/link-loan-lenders.ts <statement.csv>          # prints what would happen
 *   npx tsx scripts/finance/link-loan-lenders.ts <statement.csv> --live   # writes
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/supabase/types'
import { isValidIban, normalizeIban } from '../../src/lib/finance/iban'

function loadEnv() {
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq === -1) continue
      const key = t.slice(0, eq).trim()
      if (!(key in process.env)) process.env[key] = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '')
    }
  } catch { /* rely on process.env */ }
}
loadEnv()

const LIVE = process.argv.includes('--live')
const CSV_PATH = process.argv.slice(2).find(a => !a.startsWith('--'))

/** lender_name in finance_loans → the beneficiary name Revolut shows on the interest transfer. */
const BENEFICIARY_BY_LENDER: Record<string, string> = {
  'Tijs Louman': 'Tijs Louman',
  'Jelka Wittebol': 'Jww wittebol',
  'Irma Blackmore': 'Blackmore Beheer BV',
  'Expres Wijn B.V.': 'Expres Wijn B.V.',
  'Enrico Erkelens': 'Charinoux B.V.', // the loan money arrived from Charinoux, interest goes back there
}

/** Minimal RFC-4180 line splitter (the export quotes fields containing commas). */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (c === '"') quoted = false
      else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}

const mask = (iban: string) => `${iban.slice(0, 4)}…${iban.slice(-4)}`

async function main() {
  if (!CSV_PATH) throw new Error('Pass the Revolut statement CSV as the first argument')
  const [header, ...rows] = readFileSync(CSV_PATH, 'utf8').split(/\r?\n/).filter(Boolean).map(splitCsvLine)
  const col = (name: string) => header.indexOf(name)
  const iType = col('Type'), iState = col('State'), iDate = col('Date completed (UTC)')
  const iIban = col('Beneficiary IBAN'), iName = col('Beneficiary name')
  if ([iType, iState, iIban, iName].includes(-1)) throw new Error('Unexpected CSV columns — is this a Revolut account statement?')

  const supabase = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: loans, error } = await supabase.from('finance_loans').select('id, lender_name, supplier_id').eq('status', 'active')
  if (error) throw error

  console.log(LIVE ? 'LIVE run' : 'DRY run (add --live to write)')
  for (const loan of loans ?? []) {
    const beneficiary = BENEFICIARY_BY_LENDER[loan.lender_name]
    if (loan.supplier_id) { console.log(`= ${loan.lender_name}: already linked`); continue }
    if (!beneficiary) { console.log(`! ${loan.lender_name}: no payment in the statement — needs an IBAN added by hand`); continue }

    // Newest completed outgoing transfer to that beneficiary wins (a lender may have changed bank).
    const match = rows
      .filter(r => r[iType] === 'TRANSFER' && r[iState] === 'COMPLETED' && r[iName]?.toLowerCase() === beneficiary.toLowerCase() && r[iIban])
      .sort((a, b) => (b[iDate] ?? '').localeCompare(a[iDate] ?? ''))[0]
    const iban = match ? normalizeIban(match[iIban]) : null
    if (!iban || !isValidIban(iban)) { console.log(`! ${loan.lender_name}: no valid IBAN found for "${beneficiary}"`); continue }

    const { data: existing } = await supabase.from('finance_suppliers').select('id, name').eq('iban', iban).maybeSingle()
    console.log(`+ ${loan.lender_name} → ${beneficiary} ${mask(iban)} (${existing ? `existing supplier ${existing.name}` : 'new supplier'})`)
    if (!LIVE) continue

    let supplierId = existing?.id
    if (!supplierId) {
      const { data: created, error: insErr } = await supabase
        .from('finance_suppliers')
        .insert({ name: beneficiary, iban })
        .select('id')
        .single()
      if (insErr) throw insErr
      supplierId = created.id
    }
    const { error: linkErr } = await supabase.from('finance_loans').update({ supplier_id: supplierId }).eq('id', loan.id)
    if (linkErr) throw linkErr
  }
}

main().catch(err => { console.error(err); process.exit(1) })
