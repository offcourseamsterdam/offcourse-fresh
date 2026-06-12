import { describe, it, expect } from 'vitest'
import { parseDraftJson } from './shadow-drafter'

describe('parseDraftJson', () => {
  it('parses a clean JSON draft', () => {
    const raw = '{"reply": "Hoi! Ja hoor, dat kan.", "reasoning": "Simple yes.", "language": "Dutch"}'
    expect(parseDraftJson(raw)).toEqual({
      reply: 'Hoi! Ja hoor, dat kan.',
      reasoning: 'Simple yes.',
      language: 'Dutch',
      open_question: null,
    })
  })

  it('captures an open question for the team when the Ghost is unsure', () => {
    const raw = '{"reply": "Goede vraag!", "reasoning": "r", "language": "Dutch", "open_question": "Are dogs allowed on board?"}'
    expect(parseDraftJson(raw)?.open_question).toBe('Are dogs allowed on board?')
  })

  it('normalizes empty/whitespace open questions to null', () => {
    expect(parseDraftJson('{"reply": "Hi", "open_question": "  "}')?.open_question).toBeNull()
    expect(parseDraftJson('{"reply": "Hi", "open_question": null}')?.open_question).toBeNull()
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
    expect(parsed).toEqual({ reply: 'Hi!', reasoning: '', language: 'unknown', open_question: null })
  })

  it('trims whitespace from all fields', () => {
    const parsed = parseDraftJson('{"reply": "  Hi!  ", "reasoning": " r ", "language": " German "}')
    expect(parsed).toEqual({ reply: 'Hi!', reasoning: 'r', language: 'German', open_question: null })
  })
})
