import { simpleSource } from './simple-source'
import { fmtAdminAmountRounded } from '@/lib/admin/format'
import type { SearchSource } from './types'

/** Formats a cents field for a subtitle, omitting it entirely (not "€0") when it isn't a number. */
export function euros(cents: unknown): string | null {
  return typeof cents === 'number' ? fmtAdminAmountRounded(cents) : null
}

/**
 * One entry per external-partner source on the legacy "Kasboek" page
 * (`/admin/finance`, tab = the same `ALL_TAB_KEYS` value used there). Each
 * links straight to its tab — there's no per-record detail route for any of
 * these today, so "open the result" means "open the tab this record lives
 * on", not "open this exact row".
 */
export const FINANCE_SOURCES: SearchSource[] = [
  simpleSource({
    table: 'viator_payment_lines',
    columns: ['viator_reference', 'vendor_reference', 'tour_grade_title'],
    extraSelectColumns: ['gross_currency'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['viator'],
    toItem: row => ({
      id: `finance:viator:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `Viator · ${row.viator_reference ?? row.vendor_reference ?? '—'}`,
      subtitle: [row.tour_grade_title, row.gross_currency].filter(Boolean).join(' · ') || undefined,
      href: '/admin/finance?tab=viator',
    }),
  }),
  simpleSource({
    table: 'getyourguide_payments',
    columns: ['payment_number', 'invoice_number', 'account_number'],
    extraSelectColumns: ['amount_cents'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['getyourguide', 'gyg'],
    toItem: row => ({
      id: `finance:getyourguide:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `GetYourGuide · ${row.payment_number ?? row.invoice_number ?? '—'}`,
      subtitle: euros(row.amount_cents) ?? undefined,
      href: '/admin/finance?tab=getyourguide',
    }),
  }),
  simpleSource({
    table: 'withlocals_bookings',
    columns: ['booking_id', 'guest_name', 'tour_name', 'invoice_number'],
    extraSelectColumns: ['net_payout_cents'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['withlocals'],
    toItem: row => ({
      id: `finance:withlocals:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `Withlocals · ${row.guest_name ?? row.booking_id ?? '—'}`,
      subtitle: [row.tour_name, euros(row.net_payout_cents)].filter(Boolean).join(' · ') || undefined,
      href: '/admin/finance?tab=withlocals',
    }),
  }),
  simpleSource({
    table: 'boatlocal_payout_lines',
    columns: ['guest_name', 'cruise_name'],
    extraSelectColumns: ['total_cents'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['boatlocal', 'boat local'],
    toItem: row => ({
      id: `finance:boatlocal:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `BoatLocal · ${row.guest_name ?? '—'}`,
      subtitle: [row.cruise_name, euros(row.total_cents)].filter(Boolean).join(' · ') || undefined,
      href: '/admin/finance?tab=boatlocal',
    }),
  }),
  simpleSource({
    table: 'revolut_transactions',
    columns: ['transaction_id', 'description', 'customer_name'],
    extraSelectColumns: ['settlement_amount_cents'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['revolut'],
    toItem: row => ({
      id: `finance:revolut:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `Revolut · ${row.customer_name ?? row.description ?? '—'}`,
      subtitle: euros(row.settlement_amount_cents) ?? undefined,
      href: '/admin/finance?tab=revolut',
    }),
  }),
  simpleSource({
    table: 'clickandboat_bookings',
    columns: ['charter_number', 'listing_title', 'location'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['clickandboat', 'click and boat', 'click & boat'],
    toItem: row => ({
      id: `finance:clickandboat:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `Click & Boat · ${row.charter_number ?? '—'}`,
      subtitle: [row.listing_title, row.location].filter(Boolean).join(' · ') || undefined,
      href: '/admin/finance?tab=clickandboat',
    }),
  }),
  simpleSource({
    table: 'getmyboat_bookings',
    columns: ['booking_id', 'guest_name'],
    extraSelectColumns: ['net_amount_cents'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['getmyboat', 'get my boat'],
    toItem: row => ({
      id: `finance:getmyboat:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `GetMyBoat · ${row.guest_name ?? row.booking_id ?? '—'}`,
      subtitle: euros(row.net_amount_cents) ?? undefined,
      href: '/admin/finance?tab=getmyboat',
    }),
  }),
  simpleSource({
    table: 'barqo_bookings',
    columns: ['booking_number', 'guest_name', 'boat_name'],
    extraSelectColumns: ['net_payout_cents'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['barqo'],
    toItem: row => ({
      id: `finance:barqo:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `Barqo · ${row.guest_name ?? row.booking_number ?? '—'}`,
      subtitle: [row.boat_name, euros(row.net_payout_cents)].filter(Boolean).join(' · ') || undefined,
      href: '/admin/finance?tab=barqo',
    }),
  }),
  simpleSource({
    table: 'fareharbor_payouts',
    columns: ['payout_id', 'bank_note'],
    extraSelectColumns: ['net_cents'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['fareharbor', 'fare harbor'],
    toItem: row => ({
      id: `finance:fareharbor:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `FareHarbor payout · ${row.payout_id ?? '—'}`,
      subtitle: euros(row.net_cents) ?? undefined,
      href: '/admin/finance?tab=fareharbor',
    }),
  }),
  // Zettle has no per-transaction guest/reference data (it's monthly aggregates) —
  // "notes" is the only free text, and the name-keyword path is really the useful one here.
  simpleSource({
    table: 'zettle_monthly_sales',
    columns: ['notes'],
    extraSelectColumns: ['month', 'total_incl_vat_cents'],
    group: 'Finance',
    scope: 'finance',
    nameKeywords: ['zettle'],
    toItem: row => ({
      id: `finance:zettle:${row.id}`,
      kind: 'record',
      group: 'Finance',
      title: `Zettle · ${row.month ?? '—'}`,
      subtitle: euros(row.total_incl_vat_cents) ?? undefined,
      href: '/admin/finance?tab=zettle',
    }),
  }),
]
