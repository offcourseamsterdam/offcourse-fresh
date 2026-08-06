import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB client so we can force a failure and prove the drafter swallows it.
// vitest hoists vi.mock above all imports.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ghost/agent-runtime', () => ({ runAgenticLoop: vi.fn() }))
vi.mock('@/lib/ghost/dry-run', () => ({ dryRunBookingProposal: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/chat/translate', () => ({ translateToEnglish: vi.fn() }))

import { validateSubmission, draftShadowReply } from './shadow-drafter'
import { createAdminClient } from '@/lib/supabase/admin'
import { runAgenticLoop } from '@/lib/ghost/agent-runtime'

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

  it('keeps a correction object when present, including the booking summary fields', () => {
    const parsed = validateSubmission({
      reply: 'We found your booking and are fixing the email now.',
      language: 'English',
      reasoning: 'Exact name + date match from search_bookings_by_details.',
      correction: {
        booking_id: 'b-123',
        field: 'customer_email',
        new_value: 'suha@gmx.net',
        booking_date: '2026-08-10',
        start_time: '2026-08-10T13:00:00+00:00',
        listing_title: 'Private Hidden Gems Cruise',
        guest_count: 3,
      },
    })
    expect(parsed?.correction).toEqual({
      booking_id: 'b-123',
      field: 'customer_email',
      new_value: 'suha@gmx.net',
      booking_date: '2026-08-10',
      start_time: '2026-08-10T13:00:00+00:00',
      listing_title: 'Private Hidden Gems Cruise',
      guest_count: 3,
    })
  })

  it('drops non-object correction values', () => {
    expect(validateSubmission({ reply: 'Hi', correction: 'suha@gmx.net' })?.correction).toBeUndefined()
  })
})

describe('draftShadowReply — never breaks the customer flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('swallows errors and resolves without throwing', async () => {
    // The drafter runs in after() on the customer's send path — a failure here
    // must never surface. Force the very first DB call to throw.
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('db unreachable')
    })
    await expect(draftShadowReply('conv-1', 'msg-1')).resolves.toBeNull()
  })

  /** Full happy-path Supabase stub — everything the drafter reads/writes on a normal run. */
  function fakeSupabase({ insertError }: { insertError?: { message: string } | null } = {}) {
    return {
      from: (table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'conv-1',
                    channel: 'webchat',
                    subject: null,
                    status: 'open',
                    contact: { id: 'contact-1', name: 'Sarah Mitchell', email: 'sarah@example.com', phone_e164: null, locale: 'en', notes: null },
                  },
                }),
              }),
            }),
          }
        }
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                in: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [{ direction: 'in', body: 'Can we book Saturday?', author_name: 'Sarah', created_at: '2026-08-01T10:00:00Z' }],
                    }),
                  }),
                }),
              }),
            }),
          }
        }
        if (table === 'ghost_knowledge') {
          return {
            select: () => ({
              order: () => ({ limit: async () => ({ data: [] }) }),
              eq: async () => ({ data: [] }),
            }),
          }
        }
        if (table === 'agent_proposals') {
          return {
            select: () => ({
              in: () => ({
                not: () => ({
                  order: () => ({
                    limit: async () => ({ data: [] }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () =>
                  insertError ? { data: null, error: insertError } : { data: { id: 'proposal-1' }, error: null },
              }),
            }),
          }
        }
        throw new Error(`unexpected table "${table}"`)
      },
    }
  }

  const REPLY_SUBMISSION = {
    submission: { reply: 'Yes! Saturday works, what time suits you?', language: 'English', reasoning: 'Simple availability question.', open_question: null },
    submittedVia: 'submit_reply_draft',
    steps: [],
    turns: 1,
  }

  it('returns the drafted reply when the proposal write succeeds', async () => {
    vi.mocked(createAdminClient).mockReturnValue(fakeSupabase() as never)
    vi.mocked(runAgenticLoop).mockResolvedValue(REPLY_SUBMISSION)

    const result = await draftShadowReply('conv-1', 'msg-1')
    expect(result).toEqual({ kind: 'reply_draft', reasoning: 'Simple availability question.' })
  })

  it('returns null (not a fake success) when saving the proposal fails — the agent did real work but nothing was persisted', async () => {
    // Before this was fixed, a failed insert here fell through silently: the
    // function still returned a "success" result even though no
    // agent_proposals row — and no reviewable card — was ever created.
    vi.mocked(createAdminClient).mockReturnValue(fakeSupabase({ insertError: { message: 'row-level security violation' } }) as never)
    vi.mocked(runAgenticLoop).mockResolvedValue(REPLY_SUBMISSION)

    const result = await draftShadowReply('conv-1', 'msg-1')
    expect(result).toBeNull()
    expect(console.error).toHaveBeenCalledWith('[shadow-drafter] failed:', expect.stringContaining('row-level security violation'))
  })
})
