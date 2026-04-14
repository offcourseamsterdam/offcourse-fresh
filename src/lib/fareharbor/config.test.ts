import { describe, it, expect } from 'vitest'
import { buildTypeMapFromAvailabilities } from './config'
import type { FHMinimalAvailability } from './types'

// ── Test helper ────────────────────────────────────────────────────────────

function makeAvailability(
  rates: Array<{ ratePk: number; ctPk: number; name: string }>
): FHMinimalAvailability {
  return {
    pk: 1,
    start_at: '2026-04-08T14:00:00+02:00',
    end_at: '2026-04-08T16:00:00+02:00',
    capacity: 1,
    customer_type_rates: rates.map(r => ({
      pk: r.ratePk,
      customer_type: { pk: r.ctPk, singular: r.name, plural: r.name + 's' },
      capacity: 1,
    })),
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('buildTypeMapFromAvailabilities', () => {
  it('parses Diana 1.5h correctly', () => {
    const avail = makeAvailability([{ ratePk: 500, ctPk: 100, name: 'Diana 1.5h' }])
    const map = buildTypeMapFromAvailabilities([avail])
    const config = map.get(100)!
    expect(config.boat).toBe('diana')
    expect(config.duration).toBe(90)
    expect(config.maxGuests).toBe(8)
    expect(config.priority).toBe(1)
  })

  it('parses Curaçao 2h correctly', () => {
    const avail = makeAvailability([{ ratePk: 501, ctPk: 200, name: 'Curaçao 2h' }])
    const map = buildTypeMapFromAvailabilities([avail])
    const config = map.get(200)!
    expect(config.boat).toBe('curacao')
    expect(config.duration).toBe(120)
    expect(config.maxGuests).toBe(12)
    expect(config.priority).toBe(2)
  })

  it('parses 3h duration', () => {
    const avail = makeAvailability([{ ratePk: 502, ctPk: 300, name: 'Diana 3h' }])
    const map = buildTypeMapFromAvailabilities([avail])
    expect(map.get(300)!.duration).toBe(180)
  })

  it('defaults to 120min for unknown duration format', () => {
    const avail = makeAvailability([{ ratePk: 503, ctPk: 400, name: 'Some Custom Type' }])
    const map = buildTypeMapFromAvailabilities([avail])
    expect(map.get(400)!.duration).toBe(120)
  })

  it('defaults to curacao for unknown boat name', () => {
    const avail = makeAvailability([{ ratePk: 504, ctPk: 500, name: 'Unknown Boat 2h' }])
    const map = buildTypeMapFromAvailabilities([avail])
    const config = map.get(500)!
    expect(config.boat).toBe('curacao')
    expect(config.maxGuests).toBe(12)
  })

  it('deduplicates by customer_type.pk across slots', () => {
    const slot1 = makeAvailability([{ ratePk: 601, ctPk: 100, name: 'Diana 1.5h' }])
    const slot2 = makeAvailability([{ ratePk: 602, ctPk: 100, name: 'Diana 1.5h' }])
    const map = buildTypeMapFromAvailabilities([slot1, slot2])
    expect(map.size).toBe(1)
    expect(map.has(100)).toBe(true)
  })

  it('builds map with multiple customer types', () => {
    const avail = makeAvailability([
      { ratePk: 700, ctPk: 100, name: 'Diana 1.5h' },
      { ratePk: 701, ctPk: 200, name: 'Curaçao 2h' },
    ])
    const map = buildTypeMapFromAvailabilities([avail])
    expect(map.size).toBe(2)
    expect(map.get(100)!.boat).toBe('diana')
    expect(map.get(200)!.boat).toBe('curacao')
  })

  it('returns empty map for empty input', () => {
    const map = buildTypeMapFromAvailabilities([])
    expect(map.size).toBe(0)
  })

  it('REGRESSION: non-empty input always produces non-empty map', () => {
    const avail = makeAvailability([{ ratePk: 999, ctPk: 100, name: 'Diana 2h' }])
    const map = buildTypeMapFromAvailabilities([avail])
    expect(map.size).toBeGreaterThan(0)
  })

  it('keys by customer_type.pk, NOT rate.pk', () => {
    const avail = makeAvailability([{ ratePk: 999, ctPk: 100, name: 'Diana 1.5h' }])
    const map = buildTypeMapFromAvailabilities([avail])
    expect(map.has(100)).toBe(true)
    expect(map.has(999)).toBe(false)
  })
})
