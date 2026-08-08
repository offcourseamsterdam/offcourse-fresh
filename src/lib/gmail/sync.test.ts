import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  listNewMessages: vi.fn(),
  getMessage: vi.fn(),
  draftShadowReply: vi.fn().mockResolvedValue(undefined),
  detectCateringConfirmation: vi.fn().mockResolvedValue('unclear'),
  emitOpsEvent: vi.fn().mockResolvedValue(undefined),
  detectOtaEmail: vi.fn().mockReturnValue(null),
  checkOtaAvailability: vi.fn().mockResolvedValue({ checked: true, dateISO: '2026-09-24', guests: 2, availability: { available: true } }),
  summarizeInboundEmail: vi.fn().mockResolvedValue('mock summary'),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  detectGygReviewNotification: vi.fn().mockReturnValue(null),
  syncGYGReviews: vi.fn().mockResolvedValue({ imported: 0, skipped: 0, blocked: false }),
}))
vi.mock('./client', () => ({ listNewMessages: h.listNewMessages, getMessage: h.getMessage }))
vi.mock('./summarize', () => ({ summarizeInboundEmail: h.summarizeInboundEmail }))
vi.mock('@/lib/chat/shadow-drafter', () => ({ draftShadowReply: h.draftShadowReply }))
vi.mock('@/lib/catering/detect-confirmation', () => ({ detectCateringConfirmation: h.detectCateringConfirmation }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: h.emitOpsEvent }))
vi.mock('@/lib/ota/detect', () => ({ detectOtaEmail: h.detectOtaEmail }))
vi.mock('@/lib/ota/check-availability', () => ({ checkOtaAvailability: h.checkOtaAvailability }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/getyourguide/detect-review-notification', () => ({ detectGygReviewNotification: h.detectGygReviewNotification }))
vi.mock('@/lib/getyourguide/sync', () => ({
  syncGYGReviews: h.syncGYGReviews,
  GYG_PRODUCT_URLS: { "Private Canal Cruise Through Amsterdam's Hidden Gems": 'https://gyg.example/known-product' },
}))

const state = vi.hoisted(() => ({
  contacts: [] as { id: string; email: string; name: string }[],
  conversations: [] as { id: string; channel: string; provider_thread_id: string | null; status: string; unread_count: number; ai_summary?: string | null }[],
  bookings: [] as { id: string; catering_thread_id: string | null; catering_confirmed_at: string | null; booking_date: string | null }[],
  agentProposals: [] as Record<string, unknown>[],
  insertedMessageIds: new Set<string>(),
  nextId: 1,
  simulateConversationInsertRace: false,
}))

function freshId(prefix: string): string {
  return `${prefix}-${state.nextId++}`
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: (_col: string, email: string) => ({
              maybeSingle: async () => ({ data: state.contacts.find(c => c.email === email) ?? null }),
            }),
          }),
          insert: (row: { name: string; email: string }) => ({
            select: () => ({
              single: async () => {
                const created = { id: freshId('contact'), ...row }
                state.contacts.push(created)
                return { data: created, error: null }
              },
            }),
          }),
          update: (patch: Partial<{ name: string }>) => ({
            eq: async (_col: string, id: string) => {
              const c = state.contacts.find(c => c.id === id)
              if (c) Object.assign(c, patch)
              return { data: null, error: null }
            },
          }),
        }
      }
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: (col1: string, val1: string) => ({
              eq: (col2: string, val2: string) => ({
                maybeSingle: async () => ({
                  data:
                    state.conversations.find(c => (c as never as Record<string, unknown>)[col1] === val1 && (c as never as Record<string, unknown>)[col2] === val2) ??
                    null,
                }),
              }),
            }),
          }),
          insert: (row: { channel: string; contact_id: string; provider_thread_id: string; subject: string }) => ({
            select: () => ({
              single: async () => {
                if (state.simulateConversationInsertRace) {
                  // A concurrent poll already won the race and inserted this
                  // exact thread's conversation between our SELECT and INSERT
                  // — the real partial unique index (migration 118) is what
                  // makes Postgres actually reject this insert with 23505.
                  const winner = { id: freshId('conv'), status: 'open', unread_count: 0, ...row }
                  state.conversations.push(winner)
                  return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
                }
                const created = { id: freshId('conv'), status: 'open', unread_count: 0, ...row }
                state.conversations.push(created)
                return { data: created, error: null }
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              const c = state.conversations.find(c => c.id === id)
              if (c) Object.assign(c, patch)
              return { data: null, error: null }
            },
          }),
        }
      }
      if (table === 'bookings') {
        return {
          select: () => ({
            eq: (_col1: string, threadId: string) => ({
              is: (_col2: string, _val: null) => ({
                maybeSingle: async () => ({
                  data:
                    state.bookings.find(
                      b => b.catering_thread_id === threadId && b.catering_confirmed_at === null,
                    ) ?? null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              const b = state.bookings.find(b => b.id === id)
              if (b) Object.assign(b, patch)
              return { data: null, error: null }
            },
          }),
        }
      }
      if (table === 'messages') {
        return {
          // Two calling shapes in production: the inbound path chains
          // .select('id').single() (it needs the new row's id for Ghost);
          // handleOutboundGmailMessage awaits .insert() directly (it
          // doesn't). Both need to resolve to the same duplicate-vs-created
          // result, so it's computed once and exposed both ways.
          insert: (row: { provider_message_id: string }) => {
            const isDuplicate = state.insertedMessageIds.has(row.provider_message_id)
            if (!isDuplicate) state.insertedMessageIds.add(row.provider_message_id)
            const result = isDuplicate
              ? { data: null, error: { code: '23505', message: 'duplicate key' } }
              : { data: { id: freshId('msg') }, error: null }
            return {
              then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
              select: () => ({ single: async () => result }),
            }
          },
        }
      }
      if (table === 'agent_proposals') {
        return {
          insert: (row: Record<string, unknown>) => {
            state.agentProposals.push(row)
            return Promise.resolve({ data: null, error: null })
          },
        }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

import { syncGmailInbox } from './sync'

function gmailMessage(overrides: Partial<{
  id: string
  threadId: string
  from: { email: string; name: string }
  subject: string
  messageIdHeader: string | null
  bodyText: string
}> = {}) {
  return {
    id: 'gmail-msg-1',
    threadId: 'thread-1',
    from: { email: 'jane@example.com', name: 'Jane Doe' },
    subject: 'Booking question',
    messageIdHeader: '<abc@mail.gmail.com>',
    bodyText: 'Can we book Saturday?',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  state.contacts.length = 0
  state.conversations.length = 0
  state.bookings.length = 0
  state.agentProposals.length = 0
  state.insertedMessageIds.clear()
  state.nextId = 1
  state.simulateConversationInsertRace = false
  h.draftShadowReply.mockResolvedValue(undefined)
  h.detectCateringConfirmation.mockResolvedValue('unclear')
  h.emitOpsEvent.mockResolvedValue(undefined)
  h.detectOtaEmail.mockReturnValue(null)
  h.checkOtaAvailability.mockResolvedValue({ checked: true, dateISO: '2026-09-24', guests: 2, availability: { available: true } })
  h.summarizeInboundEmail.mockResolvedValue('mock summary')
  h.alertCronFailure.mockResolvedValue(undefined)
  h.detectGygReviewNotification.mockReturnValue(null)
  h.syncGYGReviews.mockResolvedValue({ imported: 0, skipped: 0, blocked: false })
  process.env.GMAIL_USER = 'info@offcourseamsterdam.com'
  delete process.env.GMAIL_SUPPORT_ADDRESS
})

describe('syncGmailInbox', () => {
  it('queries everything to or from the address (Promotions/Spam/Trash excluded) when no alias is configured', async () => {
    h.listNewMessages.mockResolvedValue([])
    await syncGmailInbox()
    expect(h.listNewMessages).toHaveBeenCalledWith(
      '(to:info@offcourseamsterdam.com OR from:info@offcourseamsterdam.com) -in:spam -in:trash -category:promotions newer_than:1d',
    )
  })

  it('scopes `to:` to just the support alias (not the whole shared mailbox) when GMAIL_SUPPORT_ADDRESS is set, but searches `from:` on BOTH the alias and the real account', async () => {
    // Real config, confirmed live (2026-08-06): GMAIL_SUPPORT_ADDRESS
    // (cruise@, an alias) and GMAIL_USER (info@, the authenticated account)
    // are different addresses. A reply typed directly in Gmail could go out
    // as either, depending on "send mail as" behavior this code doesn't
    // control — so `to:` stays scoped to the alias (unrelated shared-mailbox
    // traffic must not flood in), but `from:` covers both.
    process.env.GMAIL_SUPPORT_ADDRESS = 'cruise@offcourseamsterdam.com'
    h.listNewMessages.mockResolvedValue([])
    await syncGmailInbox()
    expect(h.listNewMessages).toHaveBeenCalledWith(
      '(to:cruise@offcourseamsterdam.com OR from:cruise@offcourseamsterdam.com OR from:info@offcourseamsterdam.com) -in:spam -in:trash -category:promotions newer_than:1d',
    )
  })

  it('creates a new contact and conversation for a first-time sender, then drafts a reply', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(state.contacts).toHaveLength(1)
    expect(state.contacts[0]).toMatchObject({ email: 'jane@example.com', name: 'Jane Doe' })
    expect(state.conversations).toHaveLength(1)
    expect(state.conversations[0]).toMatchObject({
      channel: 'email',
      provider_thread_id: 'thread-1',
      status: 'open',
      unread_count: 1,
    })
    expect(h.draftShadowReply).toHaveBeenCalledTimes(1)
    expect(h.draftShadowReply).toHaveBeenCalledWith(state.conversations[0].id, expect.any(String))
  })

  it('writes the AI summary onto the conversation, falling back to null context when Ghost drafted nothing', async () => {
    h.draftShadowReply.mockResolvedValue(null)
    h.summarizeInboundEmail.mockResolvedValue('Guest asks about Saturday availability.')
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())

    await syncGmailInbox()

    expect(h.summarizeInboundEmail).toHaveBeenCalledWith({
      subject: 'Booking question',
      bodyText: 'Can we book Saturday?',
      context: null,
    })
    expect(state.conversations[0].ai_summary).toBe('Guest asks about Saturday availability.')
  })

  it('folds Ghost’s reasoning into the summary context when it drafted a reply', async () => {
    h.draftShadowReply.mockResolvedValue({ kind: 'reply_draft', reasoning: 'Answered their availability question.' })
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())

    await syncGmailInbox()

    expect(h.summarizeInboundEmail).toHaveBeenCalledWith(
      expect.objectContaining({ context: 'Ghost drafted a reply: Answered their availability question.' }),
    )
  })

  it('does not fail ingestion when the summarizer returns null — leaves ai_summary unset', async () => {
    h.summarizeInboundEmail.mockResolvedValue(null)
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(state.conversations[0].ai_summary).toBeUndefined()
  })

  it('reuses the existing contact for a returning sender', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())
    await syncGmailInbox()

    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-2' }])
    h.getMessage.mockResolvedValue(gmailMessage({ id: 'gmail-msg-2', threadId: 'thread-2' }))
    await syncGmailInbox()

    expect(state.contacts).toHaveLength(1)
  })

  it('never overwrites a contact name that is already set, even if a later email has a different display name', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage({ from: { email: 'jane@example.com', name: 'Jane Doe' } }))
    await syncGmailInbox()
    expect(state.contacts[0].name).toBe('Jane Doe')

    // Same email address, but this time the sender's mail client sent a mangled display name.
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-2' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ id: 'gmail-msg-2', threadId: 'thread-2', from: { email: 'jane@example.com', name: 'undisclosed-recipients' } }),
    )
    await syncGmailInbox()

    expect(state.contacts).toHaveLength(1)
    expect(state.contacts[0].name).toBe('Jane Doe')
  })

  it('fills in a name once one arrives, for a contact that only had its email as a placeholder name', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage({ from: { email: 'jane@example.com', name: '' } }))
    await syncGmailInbox()
    expect(state.contacts[0].name).toBe('jane@example.com')

    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-2' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ id: 'gmail-msg-2', threadId: 'thread-2', from: { email: 'jane@example.com', name: 'Jane Doe' } }),
    )
    await syncGmailInbox()

    expect(state.contacts[0].name).toBe('Jane Doe')
  })

  it('recovers from a concurrent-insert race on the same thread instead of throwing — fetches the row the other poll created', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())
    state.simulateConversationInsertRace = true

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(state.conversations).toHaveLength(1)
    expect(h.draftShadowReply).toHaveBeenCalledWith(state.conversations[0].id, expect.any(String))
  })

  it('does NOT merge two different Gmail threads from the same contact into one conversation', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())
    await syncGmailInbox()

    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-2' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ id: 'gmail-msg-2', threadId: 'thread-2', subject: 'A separate complaint' }),
    )
    await syncGmailInbox()

    expect(state.conversations).toHaveLength(2)
    expect(state.conversations[0].provider_thread_id).toBe('thread-1')
    expect(state.conversations[1].provider_thread_id).toBe('thread-2')
  })

  it('reopens a resolved thread when a new message arrives in it, rather than duplicating', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())
    await syncGmailInbox()
    state.conversations[0].status = 'resolved'

    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage({ id: 'gmail-msg-2', threadId: 'thread-1' }))
    const result = await syncGmailInbox()

    expect(result.imported).toBe(1)
    expect(state.conversations).toHaveLength(1)
    expect(state.conversations[0].status).toBe('open')
    expect(state.conversations[0].unread_count).toBe(2)
  })

  it('skips a message whose provider_message_id was already ingested, without redrafting', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())
    await syncGmailInbox()
    h.draftShadowReply.mockClear()

    // Same Gmail message id shows up again on the next poll (re-poll overlap).
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())
    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 0, skipped: 1 })
    expect(h.draftShadowReply).not.toHaveBeenCalled()
  })

  it('processes multiple new messages in one poll', async () => {
    h.listNewMessages.mockResolvedValue([
      { id: 'gmail-msg-1', threadId: 'thread-1' },
      { id: 'gmail-msg-2', threadId: 'thread-2' },
    ])
    h.getMessage.mockImplementation(async (id: string) =>
      gmailMessage({ id, threadId: id === 'gmail-msg-1' ? 'thread-1' : 'thread-2' }),
    )

    const result = await syncGmailInbox()
    expect(result).toEqual({ imported: 2, skipped: 0 })
    expect(h.draftShadowReply).toHaveBeenCalledTimes(2)
  })

  it('never breaks the poll batch when fetching/matching one message throws — later messages still get imported and the failure is alerted', async () => {
    h.listNewMessages.mockResolvedValue([
      { id: 'gmail-msg-1', threadId: 'thread-1' },
      { id: 'gmail-msg-2', threadId: 'thread-2' },
    ])
    h.getMessage.mockImplementation(async (id: string) => {
      if (id === 'gmail-msg-1') throw new Error('Gmail API hiccup')
      return gmailMessage({ id, threadId: 'thread-2' })
    })

    const result = await syncGmailInbox()

    // The second message isn't dropped just because the first one's fetch threw,
    // and it's never marked ingested (no provider_message_id row), so it'll be
    // retried on the next poll instead of permanently wedging the sync.
    expect(result).toEqual({ imported: 1, skipped: 1 })
    expect(h.draftShadowReply).toHaveBeenCalledTimes(1)
    expect(h.alertCronFailure).toHaveBeenCalledWith(
      'gmail-inbox-sync',
      expect.any(Error),
      expect.stringContaining('gmail-msg-1'),
      { dmOnly: true },
    )
  })

  it('collapses multiple failures in the same poll into a single alert instead of one per message', async () => {
    h.listNewMessages.mockResolvedValue([
      { id: 'gmail-msg-1', threadId: 'thread-1' },
      { id: 'gmail-msg-2', threadId: 'thread-2' },
      { id: 'gmail-msg-3', threadId: 'thread-3' },
    ])
    h.getMessage.mockRejectedValue(new Error('Supabase is down'))

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 0, skipped: 3 })
    expect(h.alertCronFailure).toHaveBeenCalledTimes(1)
    const [, , detail] = h.alertCronFailure.mock.calls[0]
    expect(detail).toContain('3 message(s) skipped')
    expect(detail).toContain('gmail-msg-1')
    expect(detail).toContain('gmail-msg-2')
    expect(detail).toContain('gmail-msg-3')
  })
})

describe('syncGmailInbox — supplier replies to a pending catering order', () => {
  it('a confirmed reply in a matching thread sets catering_confirmed_at, emits an ops event, and skips draftShadowReply', async () => {
    state.bookings.push({
      id: 'booking-1',
      catering_thread_id: 'thread-catering-1',
      catering_confirmed_at: null,
      booking_date: '2026-08-10',
    })
    h.detectCateringConfirmation.mockResolvedValue('confirmed')
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-catering-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({
        threadId: 'thread-catering-1',
        from: { email: 'supplier@pureboats.example', name: 'Pure Boats' },
        bodyText: 'Confirmed, see you Saturday!',
      }),
    )

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.detectCateringConfirmation).toHaveBeenCalledWith('Confirmed, see you Saturday!')
    expect(state.bookings[0].catering_confirmed_at).not.toBeNull()
    expect(h.emitOpsEvent).toHaveBeenCalledTimes(1)
    expect(h.emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'catering_confirmed',
        bookingId: 'booking-1',
        payload: expect.objectContaining({ supplierEmail: 'supplier@pureboats.example' }),
      }),
    )
    expect(h.draftShadowReply).not.toHaveBeenCalled()
  })

  it('a needs_reply classification in a matching thread leaves the booking unchanged and still skips draftShadowReply', async () => {
    state.bookings.push({
      id: 'booking-2',
      catering_thread_id: 'thread-catering-2',
      catering_confirmed_at: null,
      booking_date: '2026-08-11',
    })
    h.detectCateringConfirmation.mockResolvedValue('needs_reply')
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-catering-2' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({
        threadId: 'thread-catering-2',
        from: { email: 'supplier@pureboats.example', name: 'Pure Boats' },
        bodyText: 'Do you want the vegetarian option instead?',
      }),
    )

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(state.bookings[0].catering_confirmed_at).toBeNull()
    expect(h.emitOpsEvent).not.toHaveBeenCalled()
    expect(h.draftShadowReply).not.toHaveBeenCalled()
  })

  it('a message in a thread with no matching pending catering order is unaffected — draftShadowReply still runs (regression)', async () => {
    // No bookings at all match this thread — ordinary customer conversation.
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.detectCateringConfirmation).not.toHaveBeenCalled()
    expect(h.emitOpsEvent).not.toHaveBeenCalled()
    expect(h.draftShadowReply).toHaveBeenCalledTimes(1)
  })

  it('does not re-classify a thread whose booking is already catering_confirmed', async () => {
    state.bookings.push({
      id: 'booking-3',
      catering_thread_id: 'thread-catering-3',
      catering_confirmed_at: '2026-08-01T10:00:00.000Z',
      booking_date: '2026-08-12',
    })
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-catering-3' }])
    h.getMessage.mockResolvedValue(gmailMessage({ threadId: 'thread-catering-3' }))

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.detectCateringConfirmation).not.toHaveBeenCalled()
    expect(h.draftShadowReply).toHaveBeenCalledTimes(1)
  })
})

describe('syncGmailInbox — GetYourGuide review notification emails', () => {
  it('resyncs just that product immediately and skips draftShadowReply/OTA handling', async () => {
    h.detectGygReviewNotification.mockReturnValue({
      productName: "Private Canal Cruise Through Amsterdam's Hidden Gems",
    })
    h.syncGYGReviews.mockResolvedValue({ imported: 1, skipped: 0, blocked: false })
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-gyg-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({
        threadId: 'thread-gyg-1',
        from: { email: 'do-not-reply@notification.getyourguide.com', name: 'GetYourGuide' },
        subject: 'You have a new review on GetYourGuide - 607167 (126298522)',
        bodyText: "You have received a new review for your product Private Canal Cruise Through Amsterdam's Hidden Gems.",
      }),
    )

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.syncGYGReviews).toHaveBeenCalledWith('https://gyg.example/known-product')
    expect(h.draftShadowReply).not.toHaveBeenCalled()
    expect(h.detectOtaEmail).toHaveBeenCalled() // still runs (used for conversation grouping), just never acted on
  })

  it('notes the product has no configured URL yet instead of silently doing nothing', async () => {
    h.detectGygReviewNotification.mockReturnValue({ productName: 'Some Brand New Product' })
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-gyg-2' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({
        threadId: 'thread-gyg-2',
        from: { email: 'do-not-reply@notification.getyourguide.com', name: 'GetYourGuide' },
      }),
    )

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.syncGYGReviews).not.toHaveBeenCalled()
    expect(h.summarizeInboundEmail).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.stringContaining('no page URL configured') }),
    )
  })

  it('an ordinary email that is not a GYG review notification is unaffected — draftShadowReply still runs (regression)', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.syncGYGReviews).not.toHaveBeenCalled()
    expect(h.draftShadowReply).toHaveBeenCalledTimes(1)
  })
})

describe('syncGmailInbox — OTA notification emails', () => {
  const NEW_REQUEST_OTA = {
    platform: 'withlocals' as const,
    kind: 'new_request' as const,
    bookingRef: '39f8dc7a',
    guestName: null,
    parsed: { date: 'Thursday, September 24, 2026 at 10:30', time: null, dateISO: '2026-09-24', guests: 2, experienceName: 'Private Canal Cruise' },
  }

  it('a new booking request never drafts a customer reply — it checks availability and writes an ota_availability proposal instead', async () => {
    h.detectOtaEmail.mockReturnValue(NEW_REQUEST_OTA)
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ from: { email: 'info@withlocals.com', name: 'Withlocals' }, subject: 'New booking request received from .' }),
    )

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.draftShadowReply).not.toHaveBeenCalled()
    expect(h.checkOtaAvailability).toHaveBeenCalledWith(NEW_REQUEST_OTA)
    expect(state.agentProposals).toHaveLength(1)
    expect(state.agentProposals[0]).toMatchObject({
      kind: 'ota_availability',
      conversation_id: state.conversations[0].id,
      status: 'shadow',
    })
    expect((state.agentProposals[0].payload as Record<string, unknown>)).toMatchObject({
      platform: 'withlocals',
      bookingRef: '39f8dc7a',
      checked: true,
      availability: { available: true },
    })
  })

  it('feeds the availability-check result into the AI summary as context', async () => {
    h.detectOtaEmail.mockReturnValue(NEW_REQUEST_OTA)
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ from: { email: 'info@withlocals.com', name: 'Withlocals' }, subject: 'New booking request received from .' }),
    )

    await syncGmailInbox()

    expect(h.summarizeInboundEmail).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.stringContaining('New withlocals booking request, ref 39f8dc7a') }),
    )
  })

  it('groups a later message about the same booking reference into the same conversation instead of a new thread', async () => {
    h.detectOtaEmail.mockReturnValue(NEW_REQUEST_OTA)
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ from: { email: 'info@withlocals.com', name: 'Withlocals' }, subject: 'New booking request received from .' }),
    )
    await syncGmailInbox()
    expect(state.conversations).toHaveLength(1)

    // Same booking ref, but a totally different (unthreaded) Gmail thread id — the real-world shape of a follow-up OTA email.
    h.detectOtaEmail.mockReturnValue({ ...NEW_REQUEST_OTA, kind: 'confirmed' as const })
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-2' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({
        id: 'gmail-msg-2',
        threadId: 'thread-2',
        from: { email: 'info@withlocals.com', name: 'Withlocals' },
        subject: 'Booking confirmed — ref 39f8dc7a',
      }),
    )
    const result = await syncGmailInbox()

    expect(result.imported).toBe(1)
    expect(state.conversations).toHaveLength(1) // still one conversation, matched by booking ref
    expect(state.agentProposals).toHaveLength(2)
    expect(state.agentProposals[1]).toMatchObject({ kind: 'ota_booking_ready', status: 'shadow' })
  })

  it('a confirmed booking never drafts a customer reply either — it writes an ota_booking_ready proposal for the team to review', async () => {
    h.detectOtaEmail.mockReturnValue({ ...NEW_REQUEST_OTA, kind: 'confirmed' as const })
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ from: { email: 'info@withlocals.com', name: 'Withlocals' }, subject: 'Booking confirmed — ref 39f8dc7a' }),
    )

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.draftShadowReply).not.toHaveBeenCalled()
    expect(h.checkOtaAvailability).not.toHaveBeenCalled()
    expect(state.agentProposals).toHaveLength(1)
    expect(state.agentProposals[0]).toMatchObject({ kind: 'ota_booking_ready', status: 'shadow' })
  })

  it('never breaks the poll batch when the availability check throws — the message is still imported', async () => {
    h.detectOtaEmail.mockReturnValue(NEW_REQUEST_OTA)
    h.checkOtaAvailability.mockRejectedValue(new Error('FareHarbor is down'))
    h.listNewMessages.mockResolvedValue([
      { id: 'gmail-msg-1', threadId: 'thread-1' },
      { id: 'gmail-msg-2', threadId: 'thread-2' },
    ])
    h.getMessage.mockImplementation(async (id: string) =>
      gmailMessage({
        id,
        threadId: id === 'gmail-msg-1' ? 'thread-1' : 'thread-2',
        from: { email: 'info@withlocals.com', name: 'Withlocals' },
        subject: 'New booking request received from .',
      }),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await syncGmailInbox()

    // Both messages still imported — the second one isn't dropped just because
    // the first one's OTA handling threw.
    expect(result).toEqual({ imported: 2, skipped: 0 })
    expect(state.agentProposals).toHaveLength(0)
    expect(h.summarizeInboundEmail).toHaveBeenCalledTimes(2)
  })
})

describe('syncGmailInbox — outbound replies sent directly from Gmail (not through the admin panel)', () => {
  async function seedThreadWithInboundMessage() {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(gmailMessage())
    await syncGmailInbox()
    h.draftShadowReply.mockClear()
    h.detectOtaEmail.mockClear()
  }

  it('attaches a reply sent directly from Gmail to its existing thread — no new contact, no Ghost draft', async () => {
    await seedThreadWithInboundMessage()

    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({
        id: 'gmail-msg-2',
        threadId: 'thread-1',
        from: { email: 'info@offcourseamsterdam.com', name: 'Off Course' },
        bodyText: 'Sure, 17:00 works — see you then!',
      }),
    )
    const contactsBefore = state.contacts.length

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(state.contacts).toHaveLength(contactsBefore) // no bogus contact for our own address
    expect(h.detectOtaEmail).not.toHaveBeenCalled()
    expect(h.draftShadowReply).not.toHaveBeenCalled()
    expect(state.conversations).toHaveLength(1) // attached to the existing thread, not a new one
  })

  it('flips the conversation to pending — ball in the customer\'s court — same as an admin-panel reply', async () => {
    await seedThreadWithInboundMessage()
    state.conversations[0].status = 'open'

    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ id: 'gmail-msg-2', threadId: 'thread-1', from: { email: 'info@offcourseamsterdam.com', name: 'Off Course' } }),
    )
    await syncGmailInbox()

    expect(state.conversations[0].status).toBe('pending')
  })

  it('leaves an already-resolved conversation resolved — replying to a closed thread should not silently reopen it', async () => {
    await seedThreadWithInboundMessage()
    state.conversations[0].status = 'resolved'

    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ id: 'gmail-msg-2', threadId: 'thread-1', from: { email: 'info@offcourseamsterdam.com', name: 'Off Course' } }),
    )
    await syncGmailInbox()

    expect(state.conversations[0].status).toBe('resolved')
  })

  it('skips rather than creating an orphan conversation when the thread has no existing match', async () => {
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-1', threadId: 'thread-unknown' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ id: 'gmail-msg-1', threadId: 'thread-unknown', from: { email: 'info@offcourseamsterdam.com', name: 'Off Course' } }),
    )

    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 0, skipped: 1 })
    expect(state.conversations).toHaveLength(0)
  })

  it('is idempotent — a re-poll of the same outbound message does not double-insert', async () => {
    await seedThreadWithInboundMessage()
    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({ id: 'gmail-msg-2', threadId: 'thread-1', from: { email: 'info@offcourseamsterdam.com', name: 'Off Course' } }),
    )
    await syncGmailInbox()

    const result = await syncGmailInbox() // same ref, same poll shape — simulates cron overlap

    expect(result).toEqual({ imported: 0, skipped: 1 })
  })

  it('captures a reply sent as the underlying GMAIL_USER account, not just the GMAIL_SUPPORT_ADDRESS alias', async () => {
    // The real config has these as two different addresses (cruise@ alias,
    // info@ actual account) — Gmail's own "send mail as" choice for a reply
    // typed directly in its app isn't something this code controls, so
    // either address must count as "us".
    process.env.GMAIL_SUPPORT_ADDRESS = 'cruise@offcourseamsterdam.com'
    await seedThreadWithInboundMessage()

    h.listNewMessages.mockResolvedValue([{ id: 'gmail-msg-2', threadId: 'thread-1' }])
    h.getMessage.mockResolvedValue(
      gmailMessage({
        id: 'gmail-msg-2',
        threadId: 'thread-1',
        from: { email: 'info@offcourseamsterdam.com', name: 'Off Course' }, // GMAIL_USER, not the alias
      }),
    )
    const result = await syncGmailInbox()

    expect(result).toEqual({ imported: 1, skipped: 0 })
    expect(h.draftShadowReply).not.toHaveBeenCalled()
  })
})
