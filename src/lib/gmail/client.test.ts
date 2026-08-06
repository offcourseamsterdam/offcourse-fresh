import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getGmailAccessToken: vi.fn().mockResolvedValue('test-access-token'),
}))
vi.mock('./auth', () => ({ getGmailAccessToken: h.getGmailAccessToken }))

import { listNewMessages, getMessage, sendReply, extractSenderEmail } from './client'

function b64url(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64url')
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response)
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  h.getGmailAccessToken.mockResolvedValue('test-access-token')
  vi.stubGlobal('fetch', fetchMock)
  process.env.GMAIL_USER = 'info@offcourseamsterdam.com'
  delete process.env.GMAIL_SUPPORT_ADDRESS
})

describe('extractSenderEmail', () => {
  it('parses "Name <email>" form', () => {
    expect(extractSenderEmail('Jane Doe <jane@example.com>')).toEqual({
      email: 'jane@example.com',
      name: 'Jane Doe',
    })
  })

  it('parses a quoted display name', () => {
    expect(extractSenderEmail('"Doe, Jane" <jane@example.com>')).toEqual({
      email: 'jane@example.com',
      name: 'Doe, Jane',
    })
  })

  it('falls back to the bare email as both fields when there is no display name', () => {
    expect(extractSenderEmail('jane@example.com')).toEqual({
      email: 'jane@example.com',
      name: 'jane@example.com',
    })
  })

  it('lowercases the email but preserves the display name casing', () => {
    expect(extractSenderEmail('Jane Doe <Jane@Example.COM>')).toEqual({
      email: 'jane@example.com',
      name: 'Jane Doe',
    })
  })
})

describe('listNewMessages', () => {
  it('lists a single page of results', async () => {
    mockFetchOnce({ messages: [{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't1' }] })
    const result = await listNewMessages('in:inbox')
    expect(result).toEqual([{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't1' }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('q=in%3Ainbox')
  })

  it('follows nextPageToken across multiple pages', async () => {
    mockFetchOnce({ messages: [{ id: 'm1', threadId: 't1' }], nextPageToken: 'page2' })
    mockFetchOnce({ messages: [{ id: 'm2', threadId: 't2' }] })
    const result = await listNewMessages('in:inbox')
    expect(result).toEqual([{ id: 'm1', threadId: 't1' }, { id: 'm2', threadId: 't2' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=page2')
  })

  it('returns an empty array when there are no messages', async () => {
    mockFetchOnce({})
    expect(await listNewMessages('in:inbox')).toEqual([])
  })
})

describe('getMessage', () => {
  it('extracts a plain-text body directly', async () => {
    mockFetchOnce({
      id: 'm1',
      threadId: 't1',
      payload: {
        headers: [
          { name: 'From', value: 'Jane Doe <jane@example.com>' },
          { name: 'Subject', value: 'Booking question' },
          { name: 'Message-ID', value: '<abc123@mail.gmail.com>' },
        ],
        mimeType: 'text/plain',
        body: { data: b64url('Hi, can we book Saturday?') },
      },
    })
    const msg = await getMessage('m1')
    expect(msg).toEqual({
      id: 'm1',
      threadId: 't1',
      from: { email: 'jane@example.com', name: 'Jane Doe' },
      subject: 'Booking question',
      messageIdHeader: '<abc123@mail.gmail.com>',
      bodyText: 'Hi, can we book Saturday?',
      bodyHtml: null,
    })
  })

  it('falls back to a stripped HTML body when there is no plain-text part, and keeps the raw HTML too', async () => {
    mockFetchOnce({
      id: 'm2',
      threadId: 't2',
      payload: {
        headers: [{ name: 'From', value: 'jane@example.com' }, { name: 'Subject', value: 'Hi' }],
        mimeType: 'text/html',
        body: { data: b64url('<p>Hello <b>there</b></p><p>Second line</p>') },
      },
    })
    const msg = await getMessage('m2')
    expect(msg.bodyText).toBe('Hello there\n\nSecond line')
    // bodyHtml is the RAW markup, untouched by stripHtml — the sanitizer
    // (SafeEmailHtml.tsx) is what's responsible for making this safe to
    // render, not this function.
    expect(msg.bodyHtml).toBe('<p>Hello <b>there</b></p><p>Second line</p>')
  })

  it('finds the plain-text part nested inside multipart/mixed > multipart/alternative', async () => {
    mockFetchOnce({
      id: 'm3',
      threadId: 't3',
      payload: {
        headers: [{ name: 'From', value: 'jane@example.com' }, { name: 'Subject', value: 'Hi' }],
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              { mimeType: 'text/plain', body: { data: b64url('Plain version') } },
              { mimeType: 'text/html', body: { data: b64url('<p>HTML version</p>') } },
            ],
          },
          { mimeType: 'application/pdf', body: { data: b64url('not text') } },
        ],
      },
    })
    const msg = await getMessage('m3')
    expect(msg.bodyText).toBe('Plain version')
  })

  it('returns an empty body when no text part exists at all', async () => {
    mockFetchOnce({
      id: 'm4',
      threadId: 't4',
      payload: {
        headers: [{ name: 'From', value: 'jane@example.com' }, { name: 'Subject', value: 'Hi' }],
        mimeType: 'application/pdf',
        body: { data: b64url('binary') },
      },
    })
    const msg = await getMessage('m4')
    expect(msg.bodyText).toBe('')
  })

  it('defaults messageIdHeader to null when the header is absent', async () => {
    mockFetchOnce({
      id: 'm5',
      threadId: 't5',
      payload: {
        headers: [{ name: 'From', value: 'jane@example.com' }, { name: 'Subject', value: 'Hi' }],
        mimeType: 'text/plain',
        body: { data: b64url('hi') },
      },
    })
    const msg = await getMessage('m5')
    expect(msg.messageIdHeader).toBeNull()
  })

  it('throws with the response body when the Gmail API returns an error status', async () => {
    mockFetchOnce({ error: 'not found' }, false, 404)
    await expect(getMessage('missing')).rejects.toThrow(/404/)
  })
})

describe('sendReply', () => {
  it('composes a raw message with In-Reply-To/References when a source message id is given', async () => {
    // First call: metadata lookup for the Message-ID header of the original.
    mockFetchOnce({
      id: 'orig',
      threadId: 't1',
      payload: { headers: [{ name: 'Message-ID', value: '<orig123@mail.gmail.com>' }] },
    })
    // Second call: the actual send.
    mockFetchOnce({ id: 'sent-1' })

    const result = await sendReply({
      threadId: 't1',
      to: 'jane@example.com',
      subject: 'Booking question',
      body: 'Yes, Saturday works!',
      inReplyToMessageId: 'orig',
    })

    expect(result).toEqual({ id: 'sent-1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const sendCall = fetchMock.mock.calls[1]
    expect(sendCall[0]).toContain('/messages/send')
    const sentBody = JSON.parse(sendCall[1].body as string) as { raw: string; threadId: string }
    expect(sentBody.threadId).toBe('t1')
    const decoded = Buffer.from(sentBody.raw, 'base64url').toString('utf-8')
    expect(decoded).toContain('To: jane@example.com')
    expect(decoded).toContain('Subject: Re: Booking question')
    expect(decoded).toContain('In-Reply-To: <orig123@mail.gmail.com>')
    expect(decoded).toContain('References: <orig123@mail.gmail.com>')
    expect(decoded).toContain('Yes, Saturday works!')
    expect(decoded).toContain('From: info@offcourseamsterdam.com')
  })

  it('sends from the support alias, not the underlying shared mailbox, when GMAIL_SUPPORT_ADDRESS is set', async () => {
    process.env.GMAIL_SUPPORT_ADDRESS = 'cruise@offcourseamsterdam.com'
    mockFetchOnce({ id: 'sent-alias' })
    await sendReply({ threadId: 't1', to: 'jane@example.com', subject: 'Hi', body: 'ok' })
    const decoded = Buffer.from(
      (JSON.parse(fetchMock.mock.calls[0][1].body as string) as { raw: string }).raw,
      'base64url',
    ).toString('utf-8')
    expect(decoded).toContain('From: cruise@offcourseamsterdam.com')
    expect(decoded).not.toContain('From: info@offcourseamsterdam.com')
  })

  it('does not double-prefix an already-"Re:" subject', async () => {
    mockFetchOnce({ id: 'sent-2' })
    await sendReply({ threadId: 't2', to: 'jane@example.com', subject: 'Re: Booking question', body: 'ok' })
    const decoded = Buffer.from(
      (JSON.parse(fetchMock.mock.calls[0][1].body as string) as { raw: string }).raw,
      'base64url',
    ).toString('utf-8')
    expect(decoded).toContain('Subject: Re: Booking question')
    expect(decoded).not.toContain('Re: Re:')
  })

  it('sends without In-Reply-To/References when no source message id is given', async () => {
    mockFetchOnce({ id: 'sent-3' })
    await sendReply({ threadId: 't3', to: 'jane@example.com', subject: 'Hi', body: 'ok' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const decoded = Buffer.from(
      (JSON.parse(fetchMock.mock.calls[0][1].body as string) as { raw: string }).raw,
      'base64url',
    ).toString('utf-8')
    expect(decoded).not.toContain('In-Reply-To')
  })

  it('still sends even if the In-Reply-To lookup fails (best-effort threading)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network blip'))
    mockFetchOnce({ id: 'sent-4' })
    const result = await sendReply({
      threadId: 't4',
      to: 'jane@example.com',
      subject: 'Hi',
      body: 'ok',
      inReplyToMessageId: 'orig',
    })
    expect(result).toEqual({ id: 'sent-4' })
  })
})
