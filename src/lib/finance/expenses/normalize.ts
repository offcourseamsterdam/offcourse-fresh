/**
 * The small, boring comparisons the matcher (expenses/match.ts) is built on:
 * does "BOL.COM B.V." mean the same company as "Bol.com", is €120,90 "the
 * same amount" as €121,00 after a card-fee rounding, how far apart are two
 * dates. Pure; kept separate so match.ts reads as a list of signals, not as
 * string-munging.
 */

import { daysBetween, type ISODate } from '@/lib/finance/cockpit/dates'

/** Company-form suffixes that carry no identity: "Bol.com B.V." and "Bol.com" are one supplier. */
const LEGAL_FORMS = new Set(['bv', 'b.v', 'nv', 'n.v', 'vof', 'v.o.f', 'ltd', 'limited', 'gmbh', 'ag', 'inc', 'llc', 'sa', 'sarl', 'plc', 'co', 'company', 'holding'])
/** Card-statement noise Revolut prepends/appends to a merchant name. */
const STATEMENT_NOISE = new Set(['www', 'com', 'nl', 'eu', 'shop', 'store', 'online', 'payment', 'betaling', 'ideal'])

/** Lower-cased, punctuation-free, legal forms and statement noise dropped, single-spaced. */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .toLowerCase()
    // "b.v." / "v.o.f." → "bv" / "vof" BEFORE punctuation becomes a separator, or the
    // legal form falls apart into single letters that never match LEGAL_FORMS.
    .replace(/\b(\p{L})\.(?=\p{L}\b)/gu, '$1')
    .replace(/\b(\p{L})\.(?=\p{L}\b)/gu, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(t => t && !LEGAL_FORMS.has(t) && !STATEMENT_NOISE.has(t))
    .join(' ')
    .trim()
}

/**
 * 0..1. Exact normalised match → 1. One name containing the other (a
 * statement's "BOL.COM BV AMSTERDAM" vs an invoice's "Bol.com") → 0.9.
 * Otherwise the token overlap (Jaccard), so partial brand matches score
 * something without ever reaching auto-match on their own.
 */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.9
  const ta = new Set(na.split(' '))
  const tb = new Set(nb.split(' '))
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  const union = ta.size + tb.size - shared
  return union === 0 ? 0 : Math.round((shared / union) * 100) / 100
}

/** Tolerance for "the same amount": €1 or 1%, whichever is larger — card fees and FX rounding, not a different purchase. */
export function amountTolerance(cents: number): number {
  return Math.max(100, Math.round(Math.abs(cents) * 0.01))
}

export function amountsClose(aCents: number, bCents: number): { exact: boolean; within: boolean; diffCents: number } {
  const diff = Math.abs(aCents - bCents)
  return { exact: diff === 0, within: diff <= amountTolerance(Math.max(Math.abs(aCents), Math.abs(bCents))), diffCents: diff }
}

/** Signed day distance (b − a), tolerant of ISO datetimes — both sides are cut to the date. */
export function daysFromTo(a: string, b: string): number {
  return daysBetween(a.slice(0, 10) as ISODate, b.slice(0, 10) as ISODate)
}

/** Order/invoice numbers as printed vs as they appear in a bank reference: case, spaces and '#' don't count. */
export function normalizeReference(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** True when `needle` (an order/invoice number) appears inside `haystack` (a bank reference/description), ignoring formatting. Never matches on fewer than 4 characters — "12" is not evidence. */
export function referenceContains(haystack: string | null | undefined, needle: string | null | undefined): boolean {
  const n = normalizeReference(needle)
  if (n.length < 4) return false
  return normalizeReference(haystack).includes(n)
}
