import { describe, it, expect, vi } from 'vitest'
import { extractCateringDateTime, matchCateringReplyToBooking } from './match-reply'
import type { GmailMessage } from '@/lib/gmail/client'

describe('extractCateringDateTime', () => {
  it('extracts date and time from standard catering order subject', () => {
    const subject = 'Re: Catering order - Private Hidden Gems Cruise - Tuesday, 8 September 2026 19:00'
    const result = extractCateringDateTime(subject)
    expect(result.dateStr).toBe('2026-09-08')
    expect(result.timeStr).toBe('19:00')
  })

  it('extracts date and time with booking token in subject', () => {
    const subject = 'Re: Catering order [#ceab61d8] - Private Hidden Gems Cruise - Tuesday, 8 September 2026 19:00'
    const result = extractCateringDateTime(subject)
    expect(result.dateStr).toBe('2026-09-08')
    expect(result.timeStr).toBe('19:00')
  })

  it('extracts date and time from quoted body text', () => {
    const body = `
Hi Off Course Amsterdam,
Thank you for the order, it is noted!

On Mon, 7 Sept 2026 at 22:37, Off Course Amsterdam wrote:
> Date: Tuesday, 8 September 2026
> Time: 19:00
> Guests: 8
> Items:
> - Bites Box Large (6 guests)
    `
    const result = extractCateringDateTime(body)
    expect(result.dateStr).toBe('2026-09-08')
    expect(result.timeStr).toBe('19:00')
  })

  it('handles Dutch month names', () => {
    const text = 'Catering order - 15 augustus 2026 14:30'
    const result = extractCateringDateTime(text)
    expect(result.dateStr).toBe('2026-08-15')
    expect(result.timeStr).toBe('14:30')
  })
})

describe('matchCateringReplyToBooking', () => {
  function makeMessage(overrides: Partial<GmailMessage> = {}): GmailMessage {
    return {
      id: 'msg-1',
      threadId: 'thread-1',
      from: { email: 'cruise@pureboats.com', name: 'Pure Boats' },
      to: [{ email: 'cruise@offcourseamsterdam.com', name: 'Off Course' }],
      cc: [],
      subject: 'Re: Catering order - Private Hidden Gems Cruise - Tuesday, 8 September 2026 19:00',
      messageIdHeader: '<123@pureboats.com>',
      bodyText: 'Thank you for the order, it is noted!',
      bodyHtml: null,
      attachments: [],
      ...overrides,
    }
  }

  it('matches by token in subject line', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'ceab61d8-f0b0-401c-a888-026122ba8016',
                  customer_name: 'Jessica Brennan',
                  booking_date: '2026-09-08',
                  start_time: '2026-09-08T17:00:00+00:00',
                  catering_thread_id: null,
                  catering_confirmed_at: null,
                },
              }),
            }),
          }),
        }),
      }),
    }

    const msg = makeMessage({
      subject: 'Re: Catering order [#ceab61d8] - Private Hidden Gems Cruise - Tuesday, 8 September 2026 19:00',
    })

    const result = await matchCateringReplyToBooking(mockSupabase as any, msg)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('ceab61d8-f0b0-401c-a888-026122ba8016')
  })

  it('matches by thread ID', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'booking-thread-match',
                  customer_name: 'Eric Nguyen',
                  booking_date: '2026-09-08',
                  start_time: '2026-09-08T17:00:00+00:00',
                  catering_thread_id: 'thread-match-123',
                  catering_confirmed_at: null,
                },
              }),
            }),
          }),
        }),
      }),
    }

    const msg = makeMessage({
      threadId: 'thread-match-123',
      subject: 'Re: Catering order',
    })

    const result = await matchCateringReplyToBooking(mockSupabase as any, msg)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('booking-thread-match')
  })

  it('matches semantically when token and threadId are missing', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'booking-semantic-1',
                  customer_name: 'Jessica Brennan',
                  booking_date: '2026-09-08',
                  start_time: '2026-09-08T17:00:00+00:00',
                  catering_thread_id: null,
                  catering_confirmed_at: null,
                  extras_selected: [{ category: 'food', name: 'Bites Box Large (6 guests)' }],
                },
              ],
            }),
          }),
        }),
      }),
    }

    const msg = makeMessage({
      threadId: 'new-unknown-thread',
      subject: 'Re: Catering order - Private Hidden Gems Cruise - Tuesday, 8 September 2026 19:00',
    })

    const result = await matchCateringReplyToBooking(mockSupabase as any, msg)
    expect(result).not.toBeNull()
    expect(result?.id).toBe('booking-semantic-1')
  })

  it('returns null for non-catering customer message', async () => {
    const mockSupabase = { from: vi.fn() }
    const msg = makeMessage({
      from: { email: 'customer@example.com', name: 'John Doe' },
      subject: 'Question about my boat cruise',
      bodyText: 'Can I bring my dog on board?',
    })

    const result = await matchCateringReplyToBooking(mockSupabase as any, msg)
    expect(result).toBeNull()
  })
})
