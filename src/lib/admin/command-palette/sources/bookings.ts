import { ilikePattern } from '../ilike'
import { fmtAdminDate, fmtAdminAmountRounded } from '@/lib/admin/format'
import type { PaletteItem } from '../types'
import type { AdminSupabase, SearchSource } from './types'

// Kept in sync with SearchableBooking / matchesBookingSearch in
// src/lib/admin/booking-search.ts — that predicate backs the bookings page's
// own search box over the same table; a field present in one list but not
// the other means the same query finds a booking one way but not the other.
const TEXT_COLUMNS = [
  'customer_name',
  'customer_email',
  'customer_phone',
  'listing_title',
  'tour_item_name',
  'booking_uuid',
  'stripe_payment_intent_id',
  'invoice_number',
  'company_name',
]

const EXTRA_SELECT_COLUMNS = ['booking_date', 'stripe_amount', 'booking_source', 'company_name']
const SELECT_COLUMNS = ['id', 'created_at', ...new Set([...TEXT_COLUMNS, ...EXTRA_SELECT_COLUMNS])].join(',')

/**
 * "viator", "getyourguide" etc. also surface bookings that came in through
 * that channel (`booking_source`), even though the word itself won't
 * necessarily appear in any of TEXT_COLUMNS — mirrors the real
 * `booking_source` values seen in production (website, phone_walkin,
 * boatlocal, getyourguide, complimentary, tripadvisor, viator, …).
 */
const SOURCE_KEYWORDS: Record<string, string> = {
  viator: 'viator',
  boatlocal: 'boatlocal',
  'boat local': 'boatlocal',
  getyourguide: 'getyourguide',
  gyg: 'getyourguide',
  tripadvisor: 'tripadvisor',
  complimentary: 'complimentary',
}

const LIMIT = 6

function toItem(row: Record<string, unknown>): PaletteItem {
  const title = String(row.customer_name ?? row.company_name ?? '—')
  const subtitleParts = [
    row.listing_title ?? row.tour_item_name,
    row.booking_date ? fmtAdminDate(row.booking_date as string) : null,
    typeof row.stripe_amount === 'number' ? fmtAdminAmountRounded(row.stripe_amount) : null,
  ].filter(Boolean)
  return {
    id: `booking:${row.id}`,
    kind: 'record',
    group: 'Bookings',
    title,
    subtitle: subtitleParts.length ? subtitleParts.join(' · ') : undefined,
    href: `/admin/bookings?booking=${row.id}`,
  }
}

export const bookingsSource: SearchSource = {
  group: 'Bookings',
  scope: 'bookings',
  async search(supabase: AdminSupabase, query: string): Promise<PaletteItem[]> {
    const q = query.trim()
    if (!q) return []
    const pattern = ilikePattern(q)
    // A query that's only special characters (",," "((") escapes down to
    // nothing — ilikePattern returns null rather than the always-matching
    // "%%". No text query can match it, but a source-keyword match (below)
    // still can, so this only skips the text query, not the whole search.
    const textQuery = pattern
      ? supabase
          .from('bookings')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SELECT_COLUMNS is built at runtime from a plain string[], so it can't be checked against the table's literal column-name union.
          .select(SELECT_COLUMNS as any)
          .or(TEXT_COLUMNS.map(c => `${c}.ilike.${pattern}`).join(','))
          .order('created_at', { ascending: false })
          .limit(LIMIT)
      : null

    const matchedSource = SOURCE_KEYWORDS[q.toLowerCase()]
    const sourceQuery = matchedSource
      ? supabase
          .from('bookings')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see textQuery above.
          .select(SELECT_COLUMNS as any)
          .eq('booking_source', matchedSource)
          .order('created_at', { ascending: false })
          .limit(LIMIT)
      : null

    const emptyResult = Promise.resolve({ data: [] as Record<string, unknown>[], error: null })
    const [textResult, sourceResult] = await Promise.all([
      textQuery ?? emptyResult,
      sourceQuery ?? emptyResult,
    ])

    // Same GenericStringError fallback as simple-source.ts (a runtime-built select-column
    // string can't be fully type-checked) — column names were verified by hand.
    const rows = [
      ...((textResult.data ?? []) as unknown as Record<string, unknown>[]),
      ...((sourceResult.data ?? []) as unknown as Record<string, unknown>[]),
    ]
    const byId = new Map<string, Record<string, unknown>>()
    for (const row of rows) byId.set(String(row.id), row)

    return [...byId.values()].slice(0, LIMIT).map(toItem)
  },
}
