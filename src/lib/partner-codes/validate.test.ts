import { describe, it, expect } from 'vitest'
import { validatePartnerCode, reasonMessage, type PartnerCodeRow } from './validate'
import { normalizePartnerCode, generatePartnerCode } from './generate'

const PARTNER_A = '00000000-0000-0000-0000-000000000001'
const PARTNER_B = '00000000-0000-0000-0000-000000000002'

function makeRow(overrides: Partial<PartnerCodeRow> = {}): PartnerCodeRow {
  return {
    id: 'code-1',
    partner_id: PARTNER_A,
    code: 'WBKA-2X9F',
    is_active: true,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    revoked_at: null,
    ...overrides,
  }
}

// ── Happy path ──────────────────────────────────────────────────────────────

describe('validatePartnerCode', () => {
  it('accepts an active, non-expired code for the right partner', () => {
    const result = validatePartnerCode('WBKA-2X9F', PARTNER_A, makeRow())
    expect(result.ok).toBe(true)
  })

  // ── Rejections ────────────────────────────────────────────────────────────

  it('rejects empty input', () => {
    const result = validatePartnerCode('', PARTNER_A, makeRow())
    expect(result).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects whitespace-only input', () => {
    const result = validatePartnerCode('   ', PARTNER_A, makeRow())
    expect(result).toEqual({ ok: false, reason: 'empty' })
  })

  it('rejects when no row found in DB', () => {
    const result = validatePartnerCode('WBKA-2X9F', PARTNER_A, null)
    expect(result).toEqual({ ok: false, reason: 'not_found' })
  })

  it('rejects codes belonging to a different partner', () => {
    const row = makeRow({ partner_id: PARTNER_B })
    const result = validatePartnerCode('WBKA-2X9F', PARTNER_A, row)
    expect(result).toEqual({ ok: false, reason: 'wrong_partner' })
  })

  it('rejects revoked codes', () => {
    const row = makeRow({ is_active: false, revoked_at: new Date().toISOString() })
    const result = validatePartnerCode('WBKA-2X9F', PARTNER_A, row)
    expect(result).toEqual({ ok: false, reason: 'revoked' })
  })

  it('rejects inactive codes even without revoked_at', () => {
    const row = makeRow({ is_active: false })
    const result = validatePartnerCode('WBKA-2X9F', PARTNER_A, row)
    expect(result).toEqual({ ok: false, reason: 'revoked' })
  })

  it('rejects expired codes', () => {
    const row = makeRow({ expires_at: new Date(Date.now() - 86_400_000).toISOString() })
    const result = validatePartnerCode('WBKA-2X9F', PARTNER_A, row)
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('treats codes expiring exactly now as expired', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const row = makeRow({ expires_at: '2026-01-01T00:00:00Z' })
    const result = validatePartnerCode('WBKA-2X9F', PARTNER_A, row, now)
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })
})

// ── Normalization ───────────────────────────────────────────────────────────

describe('normalizePartnerCode', () => {
  it('upcases and adds dash for 8-char input', () => {
    expect(normalizePartnerCode('wbka2x9f')).toBe('WBKA-2X9F')
  })

  it('strips internal spaces', () => {
    expect(normalizePartnerCode('wbka 2x9f')).toBe('WBKA-2X9F')
  })

  it('strips existing dashes and re-inserts the canonical one', () => {
    expect(normalizePartnerCode('WBKA-2X9F')).toBe('WBKA-2X9F')
    expect(normalizePartnerCode('wb-ka-2x9f')).toBe('WBKA-2X9F')
  })

  it('leaves too-short or too-long input uppercased but without canonical dash', () => {
    expect(normalizePartnerCode('abc')).toBe('ABC')
    expect(normalizePartnerCode('abcdefghi')).toBe('ABCDEFGHI')
  })

  it('returns empty string for empty input', () => {
    expect(normalizePartnerCode('')).toBe('')
  })
})

// ── Generation ─────────────────────────────────────────────────────────────

describe('generatePartnerCode', () => {
  it('returns codes in the XXXX-XXXX pattern', () => {
    for (let i = 0; i < 20; i++) {
      const code = generatePartnerCode()
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    }
  })

  it('never emits the forbidden lookalike characters', () => {
    const forbidden = new Set(['0', 'O', '1', 'I', '2', 'Z', '5', 'S', '8', 'B'])
    for (let i = 0; i < 100; i++) {
      const code = generatePartnerCode().replace('-', '')
      for (const ch of code) {
        expect(forbidden.has(ch)).toBe(false)
      }
    }
  })

  it('produces varied output across calls', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) seen.add(generatePartnerCode())
    expect(seen.size).toBeGreaterThan(40) // very low collision probability
  })
})

// ── User-facing messages ────────────────────────────────────────────────────

describe('reasonMessage', () => {
  it('returns a non-empty message for every reason', () => {
    const reasons = ['empty', 'not_found', 'revoked', 'expired', 'wrong_partner'] as const
    for (const r of reasons) {
      expect(reasonMessage(r)).toMatch(/\S/)
    }
  })
})
