#!/usr/bin/env -S npx tsx
/**
 * check-rebooked-bookings.ts — find bookings broken by the rebook-cancels-itself
 * bug fixed in src/app/api/admin/bookings/[id]/rebook/route.ts (the Brenda Blechle
 * incident, Aug 2026).
 *
 * The bug: the admin "Rebook" flow created the new FareHarbor booking correctly,
 * then explicitly cancelled the OLD FH booking's UUID as a "safety" cleanup step.
 * Because the old booking was already linked forward to the new one (FareHarbor's
 * `rebooking` field), that cancel call cascaded through the link and cancelled the
 * NEW booking instead — refunding the payment and silently leaving the customer
 * with nothing, while our own Supabase row still said "confirmed."
 *
 * The buggy code shipped in commit 265850c (2026-06-25) and was fixed today. This
 * script re-checks every booking touched in that window: if Supabase still thinks
 * it's active but FareHarbor says cancelled (or the UUID is gone), that's the same
 * failure signature and needs a human fix.
 *
 * READ-ONLY. Queries Supabase (Management API) + FareHarbor. Never writes anything.
 *
 * Usage (from repo root, with a real .env.local):
 *   npx tsx scripts/check-rebooked-bookings.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Load .env.local (mirrors scripts/patch-fh-notes.ts) ────────────────────────
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
const FH_APP = process.env.FAREHARBOR_API_APP!
const FH_USER = process.env.FAREHARBOR_API_USER!
const FH_EXTERNAL_BASE = 'https://fareharbor.com/api/external/v1'
const COMPANY = 'offcourse'

// The buggy rebook code was live from this commit until the fix — check everything
// touched in that window, not just upcoming bookings, so already-happened cruises
// that got silently cancelled (no-show/refund confusion) surface too.
const BUG_INTRODUCED_AT = '2026-06-25'

for (const [name, val] of [['SUPABASE_MANAGEMENT_TOKEN', MGMT], ['FAREHARBOR_API_APP', FH_APP], ['FAREHARBOR_API_USER', FH_USER]] as const) {
  if (!val) {
    console.error(`Missing required env var: ${name}`)
    process.exit(1)
  }
}

async function sql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`SQL ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T[]>
}

interface FHBookingLookup {
  booking?: { uuid: string; is_cancelled?: boolean; status?: string }
}

async function getFHBooking(uuid: string): Promise<FHBookingLookup['booking'] | null> {
  const res = await fetch(`${FH_EXTERNAL_BASE}/companies/${COMPANY}/bookings/${uuid}/`, {
    headers: { 'X-FareHarbor-API-App': FH_APP, 'X-FareHarbor-API-User': FH_USER },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`FH ${res.status}: ${await res.text()}`)
  const json = (await res.json()) as FHBookingLookup
  return json.booking ?? null
}

interface BookingRow {
  id: string
  booking_uuid: string
  status: string
  customer_name: string | null
  customer_email: string | null
  booking_date: string | null
  start_time: string | null
  booking_source: string | null
  updated_at: string
}

async function main() {
  const bookings = await sql<BookingRow>(`
    SELECT id, booking_uuid, status, customer_name, customer_email, booking_date, start_time, booking_source, updated_at
    FROM bookings
    WHERE booking_uuid IS NOT NULL
      AND status IN ('confirmed', 'booked')
      AND updated_at >= '${BUG_INTRODUCED_AT}'
    ORDER BY booking_date ASC NULLS LAST
  `)

  console.log(`Checking ${bookings.length} booking(s) touched since ${BUG_INTRODUCED_AT} that Supabase still shows as active...\n`)

  const broken: { row: BookingRow; reason: string }[] = []
  let checked = 0

  for (const row of bookings) {
    checked++
    try {
      const fhBooking = await getFHBooking(row.booking_uuid)
      if (!fhBooking) {
        broken.push({ row, reason: 'NOT FOUND in FareHarbor (404)' })
      } else if (fhBooking.is_cancelled || fhBooking.status === 'cancelled') {
        broken.push({ row, reason: 'CANCELLED in FareHarbor, but Supabase says ' + row.status })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  ⚠️  FH lookup failed for ${row.customer_name ?? row.id} (${row.booking_uuid.slice(0, 8)}): ${msg}`)
    }
    // Stay well under FareHarbor's 30 req/sec limit.
    await new Promise(r => setTimeout(r, 50))
  }

  console.log(`\nChecked ${checked} bookings.\n`)

  if (broken.length === 0) {
    console.log('✅ No other bookings show this failure signature — Brenda Blechle looks like the only one.')
    return
  }

  console.log(`🚨 ${broken.length} booking(s) with the same failure signature (Supabase active, FareHarbor cancelled/missing):\n`)
  for (const { row, reason } of broken) {
    console.log('─'.repeat(60))
    console.log(`Booking id: ${row.id}`)
    console.log(`Customer:   ${row.customer_name ?? '?'} <${row.customer_email ?? '?'}>`)
    console.log(`Date:       ${row.booking_date ?? '?'} ${row.start_time ? row.start_time.slice(11, 16) + ' UTC' : ''}`)
    console.log(`Source:     ${row.booking_source ?? '?'}`)
    console.log(`FH UUID:    ${row.booking_uuid}`)
    console.log(`Link:       https://fareharbor.com/${COMPANY}/bookings/${row.booking_uuid}/`)
    console.log(`Issue:      ${reason}`)
    console.log(`Last update: ${row.updated_at}`)
  }
  console.log('─'.repeat(60))
  console.log(`\nEach of these needs the same manual fix Brenda's got: confirm what the customer actually paid for, then rebook/reconcile by hand.`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
