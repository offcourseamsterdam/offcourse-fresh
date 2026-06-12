import { describe, it, expect } from 'vitest'
import { parseDraftJson } from './shadow-drafter'

describe('parseDraftJson', () => {
  it('parses a clean JSON draft', () => {
    const raw = '{"reply": "Hoi! Ja hoor, dat kan.", "reasoning": "Simple yes.", "language": "Dutch"}'
    expect(parseDraftJson(raw)).toEqual({
      reply: 'Hoi! Ja hoor, dat kan.',
      reasoning: 'Simple yes.',
      language: 'Dutch',
    })
  })

  it('tolerates markdown fences around the JSON', () => {
    const raw = '```json\n{"reply": "Hey!", "reasoning": "r", "language": "English"}\n```'
    expect(parseDraftJson(raw)?.reply).toBe('Hey!')
  })

  it('rejects drafts without a usable reply', () => {
    expect(parseDraftJson('{"reasoning": "no reply field"}')).toBeNull()
    expect(parseDraftJson('{"reply": ""}')).toBeNull()
    expect(parseDraftJson('{"reply": "   "}')).toBeNull()
  })

  it('rejects non-JSON output', () => {
    expect(parseDraftJson('Sorry, I cannot help with that.')).toBeNull()
    expect(parseDraftJson('')).toBeNull()
  })

  it('defaults missing optional fields instead of failing', () => {
    const parsed = parseDraftJson('{"reply": "Hi!"}')
    expect(parsed).toEqual({ reply: 'Hi!', reasoning: '', language: 'unknown' })
  })

  it('trims whitespace from all fields', () => {
    const parsed = parseDraftJson('{"reply": "  Hi!  ", "reasoning": " r ", "language": " German "}')
    expect(parsed).toEqual({ reply: 'Hi!', reasoning: 'r', language: 'German' })
  })
})
