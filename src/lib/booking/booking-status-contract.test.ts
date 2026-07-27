import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOKING_STATUSES } from './constants'

/**
 * BOOKING STATUS CONTRACT GUARDRAIL
 * =================================
 * `bookings.status` is free text (no DB constraint) — nothing stops a writer or
 * reader from using a value that doesn't match what the rest of the app expects.
 * That drift class already caused a real bug (found 2026-07): the cruise-listing
 * deletion safety check filtered on 'pending', a value nothing ever writes (the
 * real value is 'pending_payment'), and silently allowed deleting a listing with
 * money already in flight.
 *
 * This test scans every file KNOWN to read or write bookings.status (the list
 * below) and fails if any status literal it uses isn't in BOOKING_STATUSES
 * (src/lib/booking/constants.ts). It does NOT auto-discover new touch points —
 * same trade-off as admin-route-contract.test.ts's PUBLIC_EXCEPTIONS: a new file
 * that starts reading/writing bookings.status must be added to the list below,
 * which is the moment a reviewer is prompted to check its values against the
 * canonical set. Other tables have their own unrelated `status` columns (e.g.
 * image_assets: 'pending'/'processing'/'complete'/'failed') — this deliberately
 * does NOT scan the whole codebase for the word "status", which would false-positive
 * on those.
 */

const ROOT = process.cwd()

// Files confirmed (by direct reading, 2026-07) to write bookings.status.
const WRITER_FILES = [
  'src/app/api/webhooks/stripe/route.ts',
  'src/app/api/admin/booking-flow/book/route.ts',
  'src/app/api/admin/booking-flow/create-payment-link/route.ts',
  'src/app/api/cron/pending-fh-sweep/route.ts',
  'src/app/api/admin/bookings/[id]/cancel/route.ts',
]

// Files confirmed to filter/branch on bookings.status via `.in('status', [...])`.
const READER_IN_FILES = [
  'src/app/api/admin/bookings/local/route.ts',
  'src/app/api/admin/tracking/affiliates/route.ts',
  'src/app/api/admin/cruise-listings/[id]/route.ts',
  'src/app/api/admin/catering/route.ts',
  'src/app/api/admin/catering/pending-count/route.ts',
  'src/app/api/admin/catering/revenue-stats/route.ts',
  'src/app/api/cron/catering-auto-send/route.ts',
  'src/app/api/cron/extras-upsell/route.ts',
  'src/app/api/cron/fh-consistency/route.ts',
  'src/lib/tracking/queries.ts',
]

// Files confirmed to filter on bookings.status via `['a','b'].includes(status)`.
const READER_INCLUDES_FILES = [
  'src/app/api/booking/extras/[id]/route.ts',
]

const VALID = new Set<string>(BOOKING_STATUSES)

function readSource(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf-8')
}

/** Extracts every `status: '...'` write, excluding `payment_status`/other `_status` fields. */
function extractStatusWrites(source: string): string[] {
  const matches = [...source.matchAll(/(?:^|[^_a-zA-Z])status:\s*['"]([a-z_]+)['"]/g)]
  return matches.map(m => m[1])
}

/** Extracts every status literal inside a `.in('status', [...])` call. */
function extractInStatusReads(source: string): string[] {
  const calls = [...source.matchAll(/\.in\(\s*['"]status['"]\s*,\s*\[([^\]]+)\]\s*\)/g)]
  return calls.flatMap(m => [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map(x => x[1]))
}

/** Extracts every status literal inside a `[...].includes(...status...)` array. */
function extractIncludesStatusReads(source: string): string[] {
  const calls = [...source.matchAll(/\[([^\]]+)\]\.includes\(\s*\w*\.?status\b/g)]
  return calls.flatMap(m => [...m[1].matchAll(/['"]([a-z_]+)['"]/g)].map(x => x[1]))
}

describe('bookings.status contract', () => {
  it('BOOKING_STATUSES is non-empty and has no duplicates', () => {
    expect(BOOKING_STATUSES.length).toBeGreaterThan(0)
    expect(new Set(BOOKING_STATUSES).size).toBe(BOOKING_STATUSES.length)
  })

  it.each(WRITER_FILES)('%s only writes canonical bookings.status values', (relPath) => {
    const found = extractStatusWrites(readSource(relPath))
    expect(found.length).toBeGreaterThan(0) // the file must actually contain a status write
    for (const value of found) {
      expect(VALID.has(value), `"${value}" in ${relPath} is not in BOOKING_STATUSES`).toBe(true)
    }
  })

  it.each(READER_IN_FILES)('%s only filters on canonical bookings.status values (.in)', (relPath) => {
    const found = extractInStatusReads(readSource(relPath))
    expect(found.length).toBeGreaterThan(0)
    for (const value of found) {
      expect(VALID.has(value), `"${value}" in ${relPath} is not in BOOKING_STATUSES`).toBe(true)
    }
  })

  it.each(READER_INCLUDES_FILES)('%s only filters on canonical bookings.status values (.includes)', (relPath) => {
    const found = extractIncludesStatusReads(readSource(relPath))
    expect(found.length).toBeGreaterThan(0)
    for (const value of found) {
      expect(VALID.has(value), `"${value}" in ${relPath} is not in BOOKING_STATUSES`).toBe(true)
    }
  })
})
