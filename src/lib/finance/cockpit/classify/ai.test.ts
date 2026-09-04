import { describe, it, expect, vi } from 'vitest'
import { buildPrompt, classifyWithAi, parseAiAnswer, validateAiAnswer } from './ai'
import type { ClassifiableTransaction } from './rules'

const tx = (o: Partial<ClassifiableTransaction> = {}): ClassifiableTransaction => ({
  id: 't1', revolutId: 'r1', type: 'card_payment', state: 'completed',
  amountCents: -4380, feeCents: 0, createdAt: '2026-09-01T10:00:00Z',
  reference: null, description: 'To Marinaio', counterpartyName: 'Marinaio',
  counterpartyAccountType: null, merchantName: null, merchantCategoryCode: '5812',
  ...o,
})

const BOATS = [{ id: 'boat-diana-uuid-1234', name: 'Diana' }, { id: 'boat-curacao-uuid-56', name: 'Curaçao' }]

describe('buildPrompt', () => {
  it('states the direction, the amount and every taxonomy option', () => {
    const p = buildPrompt(tx(), {})
    expect(p).toContain('UITGAAND')
    expect(p).toContain('€43.80')
    expect(p).toContain('operating —')
    expect(p).toContain('crew (Schippers en bemanning)')
    expect(p).toContain('Marinaio')
  })

  it('includes the owner\'s earlier corrections so the model copies his vocabulary', () => {
    const p = buildPrompt(tx(), {
      recentCorrections: [{ label: 'Marinaio', amountCents: -4380, category: 'operating', subcategory: 'catering' }],
    })
    expect(p).toContain('EERDERE CORRECTIES')
    expect(p).toContain('operating/catering')
  })

  it('only offers boats when we have them', () => {
    expect(buildPrompt(tx(), {})).not.toContain('BOTEN')
    expect(buildPrompt(tx(), { boats: BOATS })).toContain('Diana = boat-diana-uuid-1234')
  })
})

describe('parseAiAnswer', () => {
  it('reads a clean JSON answer', () => {
    expect(parseAiAnswer('{"category":"operating","subcategory":"catering","boat_id":null,"confidence":0.82,"reason":"Restaurant"}'))
      .toMatchObject({ category: 'operating', subcategory: 'catering', confidence: 0.82 })
  })
  it('survives fences and chatter around the JSON', () => {
    const raw = 'Zeker!\n```json\n{"category":"operating","subcategory":"fuel","confidence":0.7,"reason":"Laadpaal"}\n```\n'
    expect(parseAiAnswer(raw)).toMatchObject({ category: 'operating', subcategory: 'fuel' })
  })
  it('clamps confidence into 0..1 and drops a placeholder subcategory', () => {
    expect(parseAiAnswer('{"category":"operating","subcategory":"-","confidence":5,"reason":""}'))
      .toMatchObject({ subcategory: null, confidence: 1 })
    expect(parseAiAnswer('{"category":"operating","confidence":-2,"reason":""}')?.confidence).toBe(0)
  })
  it('returns null for junk', () => {
    expect(parseAiAnswer('geen idee')).toBeNull()
    expect(parseAiAnswer('{"nope": true}')).toBeNull()
    expect(parseAiAnswer('{broken')).toBeNull()
  })
})

describe('validateAiAnswer', () => {
  it('rejects a category that contradicts the sign of the amount', () => {
    const outgoing = tx({ amountCents: -5000 })
    expect(validateAiAnswer(parseAiAnswer('{"category":"income","subcategory":"booking","confidence":0.9,"reason":"x"}'), outgoing, [])).toBeNull()
    const incoming = tx({ amountCents: 5000 })
    expect(validateAiAnswer(parseAiAnswer('{"category":"operating","subcategory":"fuel","confidence":0.9,"reason":"x"}'), incoming, [])).toBeNull()
  })

  it('rejects a category outside the taxonomy, and drops an invalid subcategory', () => {
    expect(validateAiAnswer(parseAiAnswer('{"category":"vibes","confidence":0.9,"reason":"x"}'), tx(), [])).toBeNull()
    expect(validateAiAnswer(parseAiAnswer('{"category":"operating","subcategory":"verzonnen","confidence":0.9,"reason":"x"}'), tx(), []))
      .toMatchObject({ category: 'operating', subcategory: null })
  })

  it('only accepts a boat id we actually have', () => {
    const good = validateAiAnswer(parseAiAnswer('{"category":"maintenance","subcategory":"engine","boat_id":"boat-diana-uuid-1234","confidence":0.9,"reason":"x"}'), tx(), BOATS)
    expect(good?.boatId).toBe('boat-diana-uuid-1234')
    const bad = validateAiAnswer(parseAiAnswer('{"category":"maintenance","subcategory":"engine","boat_id":"verzonnen-id-123456","confidence":0.9,"reason":"x"}'), tx(), BOATS)
    expect(bad?.boatId).toBeNull()
  })

  it('marks the result as coming from the AI', () => {
    expect(validateAiAnswer(parseAiAnswer('{"category":"operating","subcategory":"catering","confidence":0.8,"reason":"Restaurant aan het water"}'), tx(), []))
      .toMatchObject({ source: 'ai', reason: 'Restaurant aan het water' })
  })
})

describe('classifyWithAi', () => {
  it('passes the prompt to the model and returns a validated classification', async () => {
    const callModel = vi.fn().mockResolvedValue('{"category":"operating","subcategory":"catering","confidence":0.78,"reason":"Horeca"}')
    const result = await classifyWithAi(tx(), { callModel })
    expect(callModel).toHaveBeenCalledOnce()
    expect(callModel.mock.calls[0][0]).toContain('Marinaio')
    expect(result).toMatchObject({ category: 'operating', subcategory: 'catering', confidence: 0.78, source: 'ai' })
  })

  it('returns null instead of throwing when the model call fails', async () => {
    const callModel = vi.fn().mockRejectedValue(new Error('rate limited'))
    await expect(classifyWithAi(tx(), { callModel })).resolves.toBeNull()
  })

  it('returns null when the model answers nonsense, so the row stays unclassified', async () => {
    const callModel = vi.fn().mockResolvedValue('sorry, ik weet het niet')
    await expect(classifyWithAi(tx(), { callModel })).resolves.toBeNull()
  })
})
