import { describe, it, expect } from 'vitest'
import {
  computeNetRevenueCents,
  centsToMajor,
  formatConversionDateTime,
  decideUpload,
} from './conversion-value'

// ── computeNetRevenueCents ──────────────────────────────────────────────────

describe('computeNetRevenueCents', () => {
  it('base only — strips 9% VAT from the VAT-inclusive base', () => {
    // 16500 incl. 9% → VAT 1362 → net 15138
    expect(
      computeNetRevenueCents({ server_base_amount_cents: '16500', base_vat_amount_cents: '1362' }),
    ).toBe(15138)
  })

  it('base + extras — strips both VAT portions', () => {
    // base net 15138 + extras (2000 incl. 21% → VAT 347 → net 1653) = 16791
    expect(
      computeNetRevenueCents({
        server_base_amount_cents: '16500',
        base_vat_amount_cents: '1362',
        extras_amount_cents: '2000',
        extras_vat_amount_cents: '347',
      }),
    ).toBe(16791)
  })

  it('subtracts the discount', () => {
    expect(
      computeNetRevenueCents({
        server_base_amount_cents: '16500',
        base_vat_amount_cents: '1362',
        discount_amount_cents: '500',
      }),
    ).toBe(14638)
  })

  it('never goes negative', () => {
    expect(
      computeNetRevenueCents({
        server_base_amount_cents: '10000',
        base_vat_amount_cents: '826',
        discount_amount_cents: '999999',
      }),
    ).toBe(0)
  })

  it('treats missing/garbage fields as zero', () => {
    expect(computeNetRevenueCents({})).toBe(0)
    expect(computeNetRevenueCents({ server_base_amount_cents: 'abc' })).toBe(0)
  })
})

// ── centsToMajor ────────────────────────────────────────────────────────────

describe('centsToMajor', () => {
  it('converts cents to major units', () => {
    expect(centsToMajor(16500)).toBe(165)
    expect(centsToMajor(12345)).toBe(123.45)
    expect(centsToMajor(0)).toBe(0)
  })
})

// ── formatConversionDateTime ────────────────────────────────────────────────

describe('formatConversionDateTime', () => {
  it('uses +02:00 during Amsterdam summer (DST)', () => {
    expect(formatConversionDateTime(new Date('2026-05-29T10:00:00Z'))).toBe('2026-05-29 12:00:00+02:00')
  })

  it('uses +01:00 during Amsterdam winter', () => {
    expect(formatConversionDateTime(new Date('2026-01-15T10:00:00Z'))).toBe('2026-01-15 11:00:00+01:00')
  })
})

// ── decideUpload (truth table) ──────────────────────────────────────────────

describe('decideUpload', () => {
  it('skips when there is no gclid', () => {
    expect(decideUpload({ gclid: '', consent: 'yes', requireConsent: true }))
      .toEqual({ send: false, reason: 'skipped_no_gclid' })
    expect(decideUpload({ gclid: '   ', consent: 'yes', requireConsent: true }))
      .toEqual({ send: false, reason: 'skipped_no_gclid' })
    expect(decideUpload({ gclid: null, consent: 'yes', requireConsent: true }))
      .toEqual({ send: false, reason: 'skipped_no_gclid' })
  })

  it('sends when gclid present and consent given', () => {
    expect(decideUpload({ gclid: 'abc', consent: 'yes', requireConsent: true }))
      .toEqual({ send: true, reason: 'ok' })
  })

  it('skips the send (only) when consent required but not given', () => {
    expect(decideUpload({ gclid: 'abc', consent: 'no', requireConsent: true }))
      .toEqual({ send: false, reason: 'skipped_no_consent' })
    expect(decideUpload({ gclid: 'abc', consent: null, requireConsent: true }))
      .toEqual({ send: false, reason: 'skipped_no_consent' })
  })

  it('sends regardless of consent when requireConsent is off', () => {
    expect(decideUpload({ gclid: 'abc', consent: 'no', requireConsent: false }))
      .toEqual({ send: true, reason: 'ok' })
  })
})
