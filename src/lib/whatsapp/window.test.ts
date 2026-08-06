import { describe, it, expect } from 'vitest'
import { formatWindowRemaining } from './window'

const NOW = new Date('2026-08-03T12:00:00Z').getTime()

describe('formatWindowRemaining', () => {
  it('returns null for a non-WhatsApp conversation (no window set)', () => {
    expect(formatWindowRemaining(null, NOW)).toBeNull()
  })

  it('formats hours and minutes remaining', () => {
    const expiresAt = new Date(NOW + 23 * 60 * 60 * 1000 + 42 * 60 * 1000).toISOString()
    expect(formatWindowRemaining(expiresAt, NOW)).toEqual({ label: '23h 42m', closed: false })
  })

  it('drops the hours part under 1h remaining', () => {
    const expiresAt = new Date(NOW + 42 * 60 * 1000).toISOString()
    expect(formatWindowRemaining(expiresAt, NOW)).toEqual({ label: '42m', closed: false })
  })

  it('reports the window closed once expired', () => {
    const expiresAt = new Date(NOW - 60 * 1000).toISOString()
    expect(formatWindowRemaining(expiresAt, NOW)).toEqual({ label: 'Window closed — needs a template', closed: true })
  })

  it('reports closed exactly at the expiry instant', () => {
    expect(formatWindowRemaining(new Date(NOW).toISOString(), NOW)).toEqual({
      label: 'Window closed — needs a template',
      closed: true,
    })
  })

  it('rounds up to the next minute rather than showing 0m while time remains', () => {
    const expiresAt = new Date(NOW + 30_000).toISOString() // 30s left
    expect(formatWindowRemaining(expiresAt, NOW)).toEqual({ label: '1m', closed: false })
  })
})
