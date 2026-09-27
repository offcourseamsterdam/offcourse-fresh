import { describe, it, expect } from 'vitest'
import { buildAgentCard } from './agent-card'

describe('buildAgentCard', () => {
  it('includes the required top-level fields', () => {
    const card = buildAgentCard()
    expect(card.name).toBeTruthy()
    expect(card.description).toBeTruthy()
    expect(card.version).toBeTruthy()
  })

  it('advertises exactly one JSON-RPC interface pointing at /api/a2a', () => {
    const card = buildAgentCard()
    expect(card.supportedInterfaces).toHaveLength(1)
    expect(card.supportedInterfaces[0]).toEqual({
      url: 'https://offcourseamsterdam.com/api/a2a',
      protocolBinding: 'JSONRPC',
      protocolVersion: '1.0',
    })
  })

  it('declares only the capabilities actually implemented (no streaming, no push, no auth)', () => {
    const card = buildAgentCard()
    expect(card.capabilities).toEqual({
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    })
  })

  it('lists the two implemented skills with id, name, and description', () => {
    const card = buildAgentCard()
    const ids = card.skills.map((s) => s.id)
    expect(ids).toEqual(['list_cruises', 'check_availability'])
    for (const skill of card.skills) {
      expect(skill.name).toBeTruthy()
      expect(skill.description).toBeTruthy()
    }
  })
})
