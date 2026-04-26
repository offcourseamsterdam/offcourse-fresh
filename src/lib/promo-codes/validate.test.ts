import { describe, it, expect } from 'vitest'
import { normalizeCode, validatePromoCode, type PromoCodeRow } from './validate'

// ── normalizeCode ────────────────────────────────────────────────────────────

describe('normalizeCode', () => {
  it('uppercases input', () => {
    expect(normalizeCode('summer20')).toBe('SUMM-ER20')
  })

  it('strips spaces', () => {
    expect(normalizeCode('SUMM ER20')).toBe('SUMM-ER20')
  })

  it('strips existing dashes before re-inserting', () => {
    expect(normalizeCode('SUMM-ER20')).toBe('SUMM-ER20')
  })

  it('handles mixed spacing and dashes', () => {
    expect(normalizeCode('wbka 2x9f')).toBe('WBKA-2X9F')
  })

  it('returns stripped value as-is when not 8 chars', () => {
    expect(normalizeCode('ABC')).toBe('ABC')
  })
})

// ── validatePromoCode ────────────────────────────────────────────────────────

const now = new Date()
const past = new Date(now.getTime() - 1000 * 60 * 60 * 24).toISOString()   // yesterday
const future = new Date(now.getTime() + 1000 * 60 * 60 * 24).toISOString() // tomorrow

function makeCode(overrides: Partial<PromoCodeRow> = {}): PromoCodeRow {
  return {
    id: 'test-id',
    code: 'TEST-1234',
    label: 'Test Code',
    discount_type: 'percentage',
    discount_value: 10,
    fixed_discount_cents: null,
    max_uses: null,
    uses_count: 0,
    valid_from: null,
    valid_until: null,
    is_active: true,
    ...overrides,
  }
}

describe('validatePromoCode', () => {
  it('returns ok:false for empty input', async () => {
    const result = await validatePromoCode('', async () => null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty')
  })

  it('returns ok:false when code not found', async () => {
    const result = await validatePromoCode('XXXX-0000', async () => null)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_found')
  })

  it('returns ok:false when code is inactive', async () => {
    const result = await validatePromoCode('TEST-1234', async () => makeCode({ is_active: false }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('inactive')
  })

  it('returns ok:false when code is expired', async () => {
    const result = await validatePromoCode('TEST-1234', async () => makeCode({ valid_until: past }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
  })

  it('returns ok:false when not yet valid', async () => {
    const result = await validatePromoCode('TEST-1234', async () => makeCode({ valid_from: future }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_yet_valid')
  })

  it('returns ok:false when max_uses exceeded', async () => {
    const result = await validatePromoCode('TEST-1234', async () => makeCode({ max_uses: 10, uses_count: 10 }))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('max_uses_reached')
  })

  it('returns ok:true for valid code', async () => {
    const code = makeCode()
    const result = await validatePromoCode('TEST-1234', async () => code)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.code).toEqual(code)
  })

  it('normalises the code before lookup', async () => {
    let lookedUp = ''
    await validatePromoCode('test 1234', async (normalised) => {
      lookedUp = normalised
      return null
    })
    expect(lookedUp).toBe('TEST-1234')
  })

  it('passes when uses_count < max_uses', async () => {
    const result = await validatePromoCode('TEST-1234', async () => makeCode({ max_uses: 10, uses_count: 9 }))
    expect(result.ok).toBe(true)
  })

  it('passes with null valid_until (never expires)', async () => {
    const result = await validatePromoCode('TEST-1234', async () => makeCode({ valid_until: null }))
    expect(result.ok).toBe(true)
  })
})
