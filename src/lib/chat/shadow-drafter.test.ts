import { describe, it, expect } from 'vitest'
import { validateSubmission } from './shadow-drafter'

describe('validateSubmission', () => {
  it('accepts a complete reply submission', () => {
    expect(
      validateSubmission({
        reply: 'Hoi! Ja hoor, dat kan.',
        language: 'Dutch',
        reasoning: 'Simple yes.',
        open_question: null,
      }),
    ).toEqual({
      reply: 'Hoi! Ja hoor, dat kan.',
      language: 'Dutch',
      reasoning: 'Simple yes.',
      open_question: null,
      booking: undefined,
    })
  })

  it('rejects submissions without a usable reply', () => {
    expect(validateSubmission({ reasoning: 'no reply' })).toBeNull()
    expect(validateSubmission({ reply: '' })).toBeNull()
    expect(validateSubmission({ reply: '   ' })).toBeNull()
    expect(validateSubmission({ reply: 42 })).toBeNull()
  })

  it('keeps a booking object when present', () => {
    const parsed = validateSubmission({
      reply: 'Top, 17:00 is vrij!',
      language: 'Dutch',
      reasoning: 'Slot confirmed via search_availability.',
      booking: { listing_slug: 'private-hidden-gems-cruise', date: '2026-06-20', time: '5pm', guests: 4 },
    })
    expect(parsed?.booking).toMatchObject({ listing_slug: 'private-hidden-gems-cruise', guests: 4 })
  })

  it('normalizes empty open questions to null and defaults language', () => {
    const parsed = validateSubmission({ reply: 'Hi!', open_question: '  ' })
    expect(parsed).toEqual({ reply: 'Hi!', language: 'unknown', reasoning: '', open_question: null, booking: undefined })
  })

  it('trims whitespace from text fields', () => {
    const parsed = validateSubmission({ reply: '  Hi!  ', reasoning: ' r ', language: ' German ', open_question: ' Are dogs allowed? ' })
    expect(parsed).toEqual({
      reply: 'Hi!',
      language: 'German',
      reasoning: 'r',
      open_question: 'Are dogs allowed?',
      booking: undefined,
    })
  })

  it('drops non-object booking values', () => {
    expect(validateSubmission({ reply: 'Hi', booking: 'tomorrow' })?.booking).toBeUndefined()
  })
})
