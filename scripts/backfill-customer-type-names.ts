#!/usr/bin/env -S npx tsx
/**
 * One-off backfill: populate bookings.customer_type_name for historical rows.
 *
 * Why: FareHarbor's customer_type_rate PK is per-availability, so it can't be
 * mapped back to a name after the fact via the synced customer_types JSONB.
 * But each booking DOES store its fareharbor_availability_pk + rate pk, so we
 * can ask FareHarbor directly for that availability and read the label
 * (customer_type.singular, e.g. "Diana - 2 Hours").
 *
 * Best-effort: availabilities FareHarbor no longer returns (very old/purged)
 * are skipped and logged. Re-runnable — only touches rows still NULL.
 *
 * Run:  npx tsx scripts/backfill-customer-type-names.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Load .env.local (same approach as the gads CLI) ──────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const s = t.replace(/^export\s+/, '')
      const eq = s.indexOf('=')
      if (eq === -1) continue
      const key = s.slice(0, eq).trim()
      let val = s.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
      if (!(key in process.env)) process.env[key] = val
    }
  } catch { console.error('⚠️  Could not read .env.local') }
}
loadEnv()

const PROJECT = 'fkylzllxvepmrtqxisrn'
const MGMT = process.env.SUPABASE_MANAGEMENT_TOKEN!
const FH_BASE = process.env.FAREHARBOR_API_BASE ?? 'https://fareharbor.com/api/v1'
const FH_APP = process.env.FAREHARBOR_API_APP!
const FH_USER = process.env.FAREHARBOR_API_USER!
const COMPANY = 'offcourse'

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`SQL ${res.status}: ${await res.text()}`)
  return res.json()
}

type Rate = { pk: number; customer_type?: { singular?: string } }
async function fhAvailability(pk: number): Promise<{ customer_type_rates?: Rate[] }> {
  const res = await fetch(`${FH_BASE}/companies/${COMPANY}/availabilities/${pk}/`, {
    headers: { 'X-FareHarbor-API-App': FH_APP, 'X-FareHarbor-API-User': FH_USER },
  })
  if (!res.ok) throw new Error(`FH ${res.status}`)
  const json = await res.json()
  return json.availability ?? json
}

async function main() {
  const rows = await sql<{ id: string; pk: number; rate: number }>(`
    select id, fareharbor_availability_pk as pk, fareharbor_customer_type_rate_pk as rate
    from bookings
    where customer_type_name is null
      and fareharbor_availability_pk is not null
      and fareharbor_customer_type_rate_pk is not null
  `)
  console.log(`Backfilling ${rows.length} booking(s)…`)

  const cache = new Map<number, { customer_type_rates?: Rate[] }>()
  let updated = 0, skipped = 0
  for (const r of rows) {
    try {
      let detail = cache.get(r.pk)
      if (!detail) {
        detail = await fhAvailability(r.pk)
        cache.set(r.pk, detail)
        await new Promise(res => setTimeout(res, 90)) // ~11 req/s, well under FH's 30/s
      }
      const name = detail.customer_type_rates?.find(x => x.pk === r.rate)?.customer_type?.singular ?? null
      if (!name) { skipped++; console.log(`  ✗ ${r.id} — rate ${r.rate} not on avail ${r.pk}`); continue }
      await sql(`update bookings set customer_type_name = '${name.replace(/'/g, "''")}' where id = '${r.id}'`)
      updated++
      console.log(`  ✓ ${r.id} → ${name}`)
    } catch (e) {
      skipped++
      console.log(`  ✗ ${r.id} — ${e instanceof Error ? e.message : e}`)
    }
  }
  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`)
}

main().catch(e => { console.error(e); process.exit(1) })
