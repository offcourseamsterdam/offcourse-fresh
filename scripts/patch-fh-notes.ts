#!/usr/bin/env -S npx tsx
/**
 * Print FareHarbor booking notes for all upcoming bookings that have catering
 * or a guest note. FareHarbor's External API v1 does not support updating a
 * booking note after creation, so this script outputs the notes so they can
 * be copy-pasted into the FareHarbor dashboard manually.
 *
 * New bookings: the note is now included at creation time (Stripe webhook).
 * Existing bookings: use this script to get the formatted text.
 *
 * Run from the project root:
 *   npx tsx scripts/patch-fh-notes.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildFHBookingNote } from '../src/lib/catering/build-fh-note'
import type { ExtrasLineItem } from '../src/lib/catering/filter'

// ── Load .env.local ───────────────────────────────────────────────────────────
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

if (!MGMT) {
  console.error('Missing required env var: SUPABASE_MANAGEMENT_TOKEN')
  process.exit(1)
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

interface BookingRow {
  id: string
  booking_uuid: string
  guest_note: string | null
  extras_selected: unknown
  listing_title: string | null
  booking_date: string
  customer_name: string | null
}

async function main() {
  const today = new Date().toISOString().split('T')[0]

  const bookings = await sql<BookingRow>(`
    SELECT id, booking_uuid, guest_note, extras_selected, listing_title, booking_date, customer_name
    FROM bookings
    WHERE booking_date >= '${today}'
      AND booking_uuid IS NOT NULL
      AND status IN ('confirmed', 'booked')
    ORDER BY booking_date ASC
  `)

  console.log(`Found ${bookings.length} upcoming bookings with FH UUID\n`)

  let printed = 0
  let skipped = 0

  for (const booking of bookings) {
    const extras = (Array.isArray(booking.extras_selected) ? booking.extras_selected : []) as unknown as ExtrasLineItem[]
    const note = buildFHBookingNote(booking.guest_note, extras)

    if (!note) {
      skipped++
      continue
    }

    printed++
    const dashLine = '─'.repeat(60)
    console.log(dashLine)
    console.log(`📅 ${booking.booking_date}  ${booking.listing_title ?? ''}`)
    console.log(`👤 ${booking.customer_name ?? ''}  |  FH UUID: ${booking.booking_uuid}`)
    console.log(`🔗 https://fareharbor.com/offcourse/bookings/${booking.booking_uuid}/`)
    console.log()
    console.log(note)
    console.log()
  }

  if (printed === 0) {
    console.log('No bookings need a FareHarbor note update.')
  } else {
    console.log('─'.repeat(60))
    console.log(`\n${printed} booking(s) above need notes added in FareHarbor dashboard.`)
    console.log(`${skipped} booking(s) skipped (no catering or guest note).`)
    console.log(`\nTo update: open each FareHarbor link above → Edit → paste the note text.`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
