import { describe, it, expect } from 'vitest'
import { clampToolResult, previewToolResult } from './agent-runtime'
import { compactAvailability } from './tools'
import {
  agentForKind,
  agentAutonomy,
  AUTONOMY_CEILING,
  AUTONOMY_LEVEL,
  autonomyForKind,
  GHOST_AGENTS,
  IRREVERSIBLE_KINDS,
  levelRank,
} from './agents'

describe('clampToolResult', () => {
  it('passes small results through as JSON', () => {
    expect(clampToolResult({ a: 1 })).toBe('{"a":1}')
  })

  it('truncates fat results with a steer-the-model hint', () => {
    const fat = { rows: Array.from({ length: 1000 }, (_, i) => `row-${i}`) }
    const clamped = clampToolResult(fat, 200)
    expect(clamped.length).toBeLessThan(300)
    expect(clamped).toContain('truncated')
    expect(clamped).toContain('query narrower')
  })

  it('survives circular structures', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(clampToolResult(circular)).toBe('[object Object]')
  })
})

describe('previewToolResult', () => {
  it('shortens long results for the step log', () => {
    const preview = previewToolResult({ text: 'x'.repeat(2000) }, 100)
    expect(preview.length).toBeLessThanOrEqual(101)
  })
})

describe('compactAvailability', () => {
  const listing = { slug: 's', title: 'Private Cruise', category: 'private', price_display: '€310' }

  it('reports unavailable when no listing has slots', () => {
    expect(compactAvailability([{ listing, availableSlots: [] }])).toEqual({
      available: false,
      note: 'Nothing available that day for that group size.',
    })
  })

  it('compacts listings to times + options', () => {
    const result = compactAvailability([
      {
        listing,
        availableSlots: [
          {
            startTime: '5pm',
            customerTypes: [{ name: 'Diana 2h', priceCents: 31000, durationMinutes: 120 }],
          },
        ],
      },
    ]) as { available: boolean; listings: { times: string[]; options?: { price_eur: number }[] }[] }
    expect(result.available).toBe(true)
    expect(result.listings[0].times).toEqual(['5pm'])
    expect(result.listings[0].options?.[0].price_eur).toBe(310)
  })

  it('caps times at 8 per listing (context discipline)', () => {
    const slots = Array.from({ length: 20 }, (_, i) => ({ startTime: `${i}h` }))
    const result = compactAvailability([{ listing, availableSlots: slots }]) as {
      listings: { times: string[] }[]
    }
    expect(result.listings[0].times).toHaveLength(8)
  })
})

describe('agent registry', () => {
  it('maps every kind to exactly one agent', () => {
    const allKinds = GHOST_AGENTS.flatMap(a => a.kinds)
    expect(new Set(allKinds).size).toBe(allKinds.length) // no kind owned twice
    expect(agentForKind('reply_draft')?.key).toBe('inbox')
    expect(agentForKind('booking_proposal')?.key).toBe('booking')
    expect(agentForKind('schedule_day')?.key).toBe('scheduling')
    expect(agentForKind('catering_order')?.key).toBe('catering')
    expect(agentForKind('nonexistent')).toBeNull()
  })

  it('has the six agents Beer asked for', () => {
    expect(GHOST_AGENTS.map(a => a.key)).toEqual([
      'inbox',
      'booking',
      'catering',
      'scheduling',
      'maintenance',
      'storage',
    ])
  })
})

describe('autonomy ladder (the safety invariant)', () => {
  it('every kind operates at or below its ceiling', () => {
    for (const kind of Object.keys(AUTONOMY_LEVEL)) {
      expect(levelRank(AUTONOMY_LEVEL[kind])).toBeLessThanOrEqual(levelRank(AUTONOMY_CEILING[kind]))
    }
  })

  it('irreversible kinds are pinned to a dry_run ceiling — can NEVER auto-execute', () => {
    for (const kind of IRREVERSIBLE_KINDS) {
      expect(AUTONOMY_CEILING[kind]).toBe('dry_run')
      // current level also cannot exceed it
      expect(levelRank(AUTONOMY_LEVEL[kind])).toBeLessThanOrEqual(levelRank('dry_run'))
    }
  })

  it('booking is the irreversible money kind and sits at dry_run', () => {
    expect(IRREVERSIBLE_KINDS).toContain('booking_proposal')
    expect(autonomyForKind('booking_proposal')).toBe('dry_run')
  })

  it('agentAutonomy reports the booking agent at dry_run, inbox at propose', () => {
    const booking = GHOST_AGENTS.find(a => a.key === 'booking')!
    const inbox = GHOST_AGENTS.find(a => a.key === 'inbox')!
    expect(agentAutonomy(booking)).toBe('dry_run')
    expect(agentAutonomy(inbox)).toBe('propose')
  })

  it('levelRank orders the ladder correctly', () => {
    expect(levelRank('propose')).toBeLessThan(levelRank('dry_run'))
    expect(levelRank('dry_run')).toBeLessThan(levelRank('ask'))
    expect(levelRank('ask')).toBeLessThan(levelRank('auto'))
  })
})
