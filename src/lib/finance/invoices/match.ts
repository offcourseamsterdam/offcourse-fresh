/**
 * Pure matching engine for the Finance Inbox (§6, docs/plans/2026-09-04-financial-management-module.md).
 *
 * Given what Gemini extracted off a PDF and a shortlist of candidate shifts
 * (already narrowed by the caller to the resolved supplier's staff_id, ±3
 * days of the invoice's tour_date, or a booking_ref match), picks the best
 * shift and runs the 8 checks that decide whether the invoice is "Goed om
 * te betalen" or needs a human. No DB access, no AI calls — everything here
 * is a pure function of its inputs, so every check has a fixture test.
 */

import { daysBetween, roundCents, type ISODate } from '../cockpit/dates'

export interface ExtractedInvoiceFields {
  invoiceNumber: string | null
  invoiceDate: ISODate | null
  supplierName: string | null
  iban: string | null
  tourDate: ISODate | null
  bookingRef: string | null
  hours: number | null
  rateCents: number | null
  amountCents: number | null
  vatCents: number | null
}

export interface CandidateShift {
  id: string
  /** bookings.id (uuid) — written straight through to finance_invoices.matched_booking_id, never compared against invoice text. */
  bookingId: string | null
  /** bookings.booking_id (human-readable ref, e.g. "OC-2026-00123") — what a skipper might actually write on an invoice, compared against extracted.bookingRef. Never a uuid. */
  bookingRef: string | null
  date: ISODate
  /** ISO datetime — used with endAt to derive the hours actually worked. */
  startAt: string
  endAt: string
}

export interface SupplierForMatch {
  id: string
  name: string
  /** Set when this supplier is a skipper being paid for hours — drives the skipper/hours/rate checks. Null for a non-skipper supplier (marina, insurer, ...). */
  staffId: string | null
  iban: string | null
  /** Staff's agreed rate at match time — 0/null means "no agreed rate yet", which the rate check must fail on, never silently accept. */
  hourlyRateCents: number | null
}

export type InvoiceCheckKey = 'skipper' | 'booking' | 'date' | 'hours' | 'rate' | 'amount' | 'duplicate' | 'iban'

export interface InvoiceCheck {
  key: InvoiceCheckKey
  ok: boolean
  detail: string
}

export interface MatchResult {
  matchedShiftId: string | null
  matchedBookingId: string | null
  expectedAmountCents: number | null
  checks: InvoiceCheck[]
  status: 'ready' | 'needs_review'
}

const MAX_TOUR_DATE_DRIFT_DAYS = 3

function centsToEuroStr(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`
}

/** Hours actually worked on a shift, from its start/end timestamps. */
function shiftHours(shift: CandidateShift): number {
  const ms = new Date(shift.endAt).getTime() - new Date(shift.startAt).getTime()
  return ms / 3_600_000
}

/** Prefers an exact booking_ref match; otherwise the candidate closest to the invoice's tour_date. */
function pickBestShift(extracted: ExtractedInvoiceFields, candidates: CandidateShift[]): CandidateShift | null {
  if (candidates.length === 0) return null
  if (extracted.bookingRef) {
    const byRef = candidates.find(c => c.bookingRef && c.bookingRef === extracted.bookingRef)
    if (byRef) return byRef
  }
  if (!extracted.tourDate) return candidates[0]
  return [...candidates].sort(
    (a, b) => Math.abs(daysBetween(extracted.tourDate as ISODate, a.date)) - Math.abs(daysBetween(extracted.tourDate as ISODate, b.date)),
  )[0]
}

export function matchInvoice(input: {
  extracted: ExtractedInvoiceFields
  supplier: SupplierForMatch | null
  candidateShifts: CandidateShift[]
  /** Invoice numbers already on file for this supplier (existing finance_invoices rows), for the duplicate check. */
  existingInvoiceNumbers: string[]
}): MatchResult {
  const { extracted, supplier, candidateShifts, existingInvoiceNumbers } = input
  const checks: InvoiceCheck[] = []

  // skipper — did we resolve a known, paid skipper for this invoice at all?
  if (supplier?.staffId) {
    checks.push({ key: 'skipper', ok: true, detail: `Skipper herkend: ${supplier.name}` })
  } else if (supplier) {
    checks.push({ key: 'skipper', ok: false, detail: `${supplier.name} is geen gekoppelde skipper — controleer handmatig` })
  } else {
    checks.push({ key: 'skipper', ok: false, detail: 'Afzender onbekend — koppel handmatig aan een skipper of leverancier' })
  }

  const matchedShift = supplier?.staffId ? pickBestShift(extracted, candidateShifts) : null

  // booking — did we find a shift to check this invoice against?
  if (matchedShift) {
    checks.push({ key: 'booking', ok: true, detail: `Gekoppeld aan dienst van ${matchedShift.date}` })
  } else if (supplier?.staffId) {
    checks.push({ key: 'booking', ok: false, detail: 'Geen gekoppelde dienst gevonden — koppel handmatig aan boeking' })
  } else {
    checks.push({ key: 'booking', ok: false, detail: 'Geen dienst te koppelen zonder herkende skipper' })
  }

  // date — does the invoice's own tour_date line up with the matched shift?
  if (!extracted.tourDate) {
    checks.push({ key: 'date', ok: false, detail: 'Geen datum op factuur gevonden' })
  } else if (!matchedShift) {
    checks.push({ key: 'date', ok: false, detail: 'Geen dienst om datum tegen te controleren' })
  } else {
    const drift = Math.abs(daysBetween(extracted.tourDate, matchedShift.date))
    checks.push(
      drift <= MAX_TOUR_DATE_DRIFT_DAYS
        ? { key: 'date', ok: true, detail: `Factuurdatum ${extracted.tourDate} komt overeen met dienst ${matchedShift.date}` }
        : { key: 'date', ok: false, detail: `Factuurdatum ${extracted.tourDate} wijkt ${drift} dagen af van dienst ${matchedShift.date}` },
    )
  }

  // hours — what the invoice claims vs. what the shift actually ran.
  const actualHours = matchedShift ? shiftHours(matchedShift) : null
  if (extracted.hours == null) {
    checks.push({ key: 'hours', ok: false, detail: 'Geen uren op factuur gevonden' })
  } else if (actualHours == null) {
    checks.push({ key: 'hours', ok: false, detail: 'Geen dienst om uren tegen te controleren' })
  } else {
    const matches = Math.abs(extracted.hours - actualHours) < 0.01
    checks.push(
      matches
        ? { key: 'hours', ok: true, detail: `${extracted.hours} uur komt overeen met de dienst` }
        : { key: 'hours', ok: false, detail: `Factuur ${extracted.hours} uur, dienst was ${actualHours} uur` },
    )
  }

  // rate — the invoice's rate vs. the skipper's agreed hourly rate. A missing/zero
  // agreed rate must fail, not pass silently — see plan §6's data-dependency note.
  const agreedRateCents = supplier?.hourlyRateCents
  if (!agreedRateCents) {
    checks.push({ key: 'rate', ok: false, detail: 'Geen afgesproken tarief' })
  } else if (extracted.rateCents == null) {
    checks.push({ key: 'rate', ok: false, detail: 'Geen tarief op factuur gevonden' })
  } else {
    const matches = extracted.rateCents === agreedRateCents
    checks.push(
      matches
        ? { key: 'rate', ok: true, detail: `${centsToEuroStr(extracted.rateCents)}/uur komt overeen met het afgesproken tarief` }
        : { key: 'rate', ok: false, detail: `Afgesproken ${centsToEuroStr(agreedRateCents)}/uur, factuur ${centsToEuroStr(extracted.rateCents)}/uur` },
    )
  }

  const expectedAmountCents = actualHours != null && agreedRateCents ? roundCents(actualHours * agreedRateCents) : null

  // amount — what's actually owed (hours worked × agreed rate) vs. what the invoice asks for.
  if (extracted.amountCents == null) {
    checks.push({ key: 'amount', ok: false, detail: 'Geen bedrag op factuur gevonden' })
  } else if (expectedAmountCents == null) {
    checks.push({ key: 'amount', ok: false, detail: 'Geen verwacht bedrag te berekenen' })
  } else {
    const diff = extracted.amountCents - expectedAmountCents
    checks.push(
      diff === 0
        ? { key: 'amount', ok: true, detail: `${centsToEuroStr(extracted.amountCents)} komt overeen met het verwachte bedrag` }
        : {
            key: 'amount',
            ok: false,
            detail: `Afgesproken ${centsToEuroStr(expectedAmountCents)}, factuur ${centsToEuroStr(extracted.amountCents)}, ${diff > 0 ? '+' : ''}${centsToEuroStr(diff)}`,
          },
    )
  }

  // duplicate — has this invoice number already been filed for this supplier?
  if (!extracted.invoiceNumber) {
    checks.push({ key: 'duplicate', ok: false, detail: 'Geen factuurnummer gevonden — dubbele factuur niet uit te sluiten' })
  } else {
    const isDuplicate = existingInvoiceNumbers.includes(extracted.invoiceNumber)
    checks.push(
      isDuplicate
        ? { key: 'duplicate', ok: false, detail: `Factuurnummer ${extracted.invoiceNumber} is al eerder ingediend` }
        : { key: 'duplicate', ok: true, detail: 'Geen dubbele factuur gevonden' },
    )
  }

  // iban — does the invoice's bank account match what we have on file for this supplier?
  if (!extracted.iban) {
    checks.push({ key: 'iban', ok: false, detail: 'Geen IBAN op factuur gevonden' })
  } else if (!supplier?.iban) {
    checks.push({ key: 'iban', ok: false, detail: 'Geen bekend rekeningnummer om tegen te controleren' })
  } else {
    const normalize = (iban: string) => iban.replace(/\s+/g, '').toUpperCase()
    const matches = normalize(extracted.iban) === normalize(supplier.iban)
    checks.push(
      matches
        ? { key: 'iban', ok: true, detail: 'IBAN komt overeen' }
        : { key: 'iban', ok: false, detail: `IBAN op factuur (${extracted.iban}) wijkt af van bekend rekeningnummer` },
    )
  }

  return {
    matchedShiftId: matchedShift?.id ?? null,
    matchedBookingId: matchedShift?.bookingId ?? null,
    expectedAmountCents,
    checks,
    status: checks.every(c => c.ok) ? 'ready' : 'needs_review',
  }
}
