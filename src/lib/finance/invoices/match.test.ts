import { describe, it, expect } from 'vitest'
import { matchInvoice, type CandidateShift, type ExtractedInvoiceFields, type SupplierForMatch } from './match'

const extracted = (o: Partial<ExtractedInvoiceFields> = {}): ExtractedInvoiceFields => ({
  invoiceNumber: 'INV-001',
  invoiceDate: '2026-09-01',
  supplierName: 'Mare',
  iban: 'NL91ABNA0417164300',
  tourDate: '2026-08-30',
  bookingRef: null,
  hours: 4,
  rateCents: 2000,
  amountCents: 8000,
  vatCents: 0,
  ...o,
})

const shift = (o: Partial<CandidateShift> = {}): CandidateShift => ({
  id: 'shift-1',
  bookingId: 'uuid-booking-1',
  bookingRef: 'OC-2026-00001',
  date: '2026-08-30',
  startAt: '2026-08-30T14:00:00Z',
  endAt: '2026-08-30T18:00:00Z', // 4 hours
  ...o,
})

const supplier = (o: Partial<SupplierForMatch> = {}): SupplierForMatch => ({
  id: 'sup-1',
  name: 'Mare',
  staffId: 'staff-1',
  iban: 'NL91ABNA0417164300',
  hourlyRateCents: 2000,
  ...o,
})

describe('matchInvoice', () => {
  it('everything lines up → ready, all checks pass', () => {
    const result = matchInvoice({
      extracted: extracted(),
      supplier: supplier(),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    expect(result.status).toBe('ready')
    expect(result.checks.every(c => c.ok)).toBe(true)
    expect(result.matchedShiftId).toBe('shift-1')
    expect(result.matchedBookingId).toBe('uuid-booking-1')
    expect(result.expectedAmountCents).toBe(8000)
  })

  it('amount over the expected → amount check fails with the diff spelled out', () => {
    const result = matchInvoice({
      extracted: extracted({ amountCents: 9000 }),
      supplier: supplier(),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    expect(result.status).toBe('needs_review')
    const amount = result.checks.find(c => c.key === 'amount')
    expect(amount?.ok).toBe(false)
    expect(amount?.detail).toContain('+€10.00')
    expect(amount?.detail).toContain('€80.00')
    expect(amount?.detail).toContain('€90.00')
  })

  it('wrong hours on the invoice vs. the actual shift duration → hours check fails', () => {
    const result = matchInvoice({
      extracted: extracted({ hours: 5, amountCents: 10000 }),
      supplier: supplier(),
      candidateShifts: [shift()], // shift is still 4 hours
      existingInvoiceNumbers: [],
    })
    const hours = result.checks.find(c => c.key === 'hours')
    expect(hours?.ok).toBe(false)
    expect(hours?.detail).toBe('Factuur 5 uur, dienst was 4 uur')
    expect(result.status).toBe('needs_review')
  })

  it('wrong rate vs. the staff-agreed rate → rate (and amount) check fails', () => {
    const result = matchInvoice({
      extracted: extracted({ rateCents: 2500, amountCents: 10000 }),
      supplier: supplier({ hourlyRateCents: 2000 }),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    const rate = result.checks.find(c => c.key === 'rate')
    expect(rate?.ok).toBe(false)
    expect(rate?.detail).toBe('Afgesproken €20.00/uur, factuur €25.00/uur')
    expect(result.status).toBe('needs_review')
  })

  it('duplicate invoice number for this supplier → duplicate check fails', () => {
    const result = matchInvoice({
      extracted: extracted({ invoiceNumber: 'INV-001' }),
      supplier: supplier(),
      candidateShifts: [shift()],
      existingInvoiceNumbers: ['INV-001', 'INV-000'],
    })
    const dup = result.checks.find(c => c.key === 'duplicate')
    expect(dup?.ok).toBe(false)
    expect(dup?.detail).toContain('INV-001')
    expect(result.status).toBe('needs_review')
  })

  it('IBAN on the invoice differs from what we have on file → iban check fails', () => {
    const result = matchInvoice({
      extracted: extracted({ iban: 'NL02RABO0123456789' }),
      supplier: supplier({ iban: 'NL91ABNA0417164300' }),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    const iban = result.checks.find(c => c.key === 'iban')
    expect(iban?.ok).toBe(false)
    expect(iban?.detail).toContain('NL02RABO0123456789')
    expect(result.status).toBe('needs_review')
  })

  it('IBAN matches ignoring spacing/case', () => {
    const result = matchInvoice({
      extracted: extracted({ iban: 'nl91 abna 0417 1643 00' }),
      supplier: supplier({ iban: 'NL91ABNA0417164300' }),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    expect(result.checks.find(c => c.key === 'iban')?.ok).toBe(true)
  })

  it('staff has no agreed rate yet (0 cents) → rate check fails, never silently accepted', () => {
    const result = matchInvoice({
      extracted: extracted(),
      supplier: supplier({ hourlyRateCents: 0 }),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    const rate = result.checks.find(c => c.key === 'rate')
    expect(rate?.ok).toBe(false)
    expect(rate?.detail).toBe('Geen afgesproken tarief')
    expect(result.status).toBe('needs_review')
  })

  it('staff has null agreed rate → rate check fails the same way as 0', () => {
    const result = matchInvoice({
      extracted: extracted(),
      supplier: supplier({ hourlyRateCents: null }),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    expect(result.checks.find(c => c.key === 'rate')?.detail).toBe('Geen afgesproken tarief')
  })

  it('no candidate shift at all → booking/date/hours/amount checks fail, never invent a match', () => {
    const result = matchInvoice({
      extracted: extracted(),
      supplier: supplier(),
      candidateShifts: [],
      existingInvoiceNumbers: [],
    })
    expect(result.matchedShiftId).toBeNull()
    expect(result.matchedBookingId).toBeNull()
    expect(result.expectedAmountCents).toBeNull()
    expect(result.checks.find(c => c.key === 'booking')?.ok).toBe(false)
    expect(result.checks.find(c => c.key === 'date')?.ok).toBe(false)
    expect(result.checks.find(c => c.key === 'hours')?.ok).toBe(false)
    expect(result.checks.find(c => c.key === 'amount')?.ok).toBe(false)
    expect(result.status).toBe('needs_review')
  })

  it('unresolved sender (no supplier match at all) → skipper check fails, everything else follows', () => {
    const result = matchInvoice({
      extracted: extracted(),
      supplier: null,
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    expect(result.checks.find(c => c.key === 'skipper')?.ok).toBe(false)
    expect(result.checks.find(c => c.key === 'skipper')?.detail).toContain('Afzender onbekend')
    expect(result.matchedShiftId).toBeNull()
    expect(result.status).toBe('needs_review')
  })

  it('resolved supplier is not a skipper (staffId null) → skipper check fails by name, no shift matched', () => {
    const result = matchInvoice({
      extracted: extracted(),
      supplier: supplier({ staffId: null, name: 'Jachthaven Westerdok' }),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    expect(result.checks.find(c => c.key === 'skipper')?.detail).toContain('Jachthaven Westerdok')
    expect(result.matchedShiftId).toBeNull()
  })

  it('picks the shift matching bookingRef over the nearest-date one when both are candidates', () => {
    const near = shift({ id: 'shift-near', date: '2026-08-29', bookingId: 'uuid-near', bookingRef: 'OC-2026-00099' })
    const byRef = shift({ id: 'shift-ref', date: '2026-08-25', bookingId: 'uuid-ref', bookingRef: 'booking-ref-match' })
    const result = matchInvoice({
      extracted: extracted({ bookingRef: 'booking-ref-match', tourDate: '2026-08-30' }),
      supplier: supplier(),
      candidateShifts: [near, byRef],
      existingInvoiceNumbers: [],
    })
    expect(result.matchedShiftId).toBe('shift-ref')
  })

  it('no invoice number extracted → duplicate check fails rather than assuming unique', () => {
    const result = matchInvoice({
      extracted: extracted({ invoiceNumber: null }),
      supplier: supplier(),
      candidateShifts: [shift()],
      existingInvoiceNumbers: [],
    })
    expect(result.checks.find(c => c.key === 'duplicate')?.ok).toBe(false)
  })

  it('tour date drifts more than 3 days from the matched shift → date check fails', () => {
    const result = matchInvoice({
      extracted: extracted({ tourDate: '2026-08-20' }),
      supplier: supplier(),
      candidateShifts: [shift({ date: '2026-08-30' })],
      existingInvoiceNumbers: [],
    })
    expect(result.checks.find(c => c.key === 'date')?.ok).toBe(false)
  })
})
