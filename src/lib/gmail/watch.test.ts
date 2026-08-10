import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getGmailAccessToken: vi.fn().mockResolvedValue('test-access-token'),
}))
vi.mock('./auth', () => ({ getGmailAccessToken: h.getGmailAccessToken }))

import { registerGmailWatch } from './watch'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  h.getGmailAccessToken.mockResolvedValue('test-access-token')
  vi.stubGlobal('fetch', fetchMock)
  process.env.GMAIL_USER = 'info@offcourseamsterdam.com'
  process.env.GMAIL_PUBSUB_TOPIC = 'projects/off-course-amsterdam/topics/gmail-push'
})

describe('registerGmailWatch', () => {
  it('posts to the Gmail watch endpoint with the configured topic and INBOX label', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ historyId: '12345', expiration: '1234567890000' }),
      text: async () => '',
    } as Response)

    const result = await registerGmailWatch()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/info%40offcourseamsterdam.com/watch',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-access-token' }),
        body: JSON.stringify({ topicName: 'projects/off-course-amsterdam/topics/gmail-push', labelIds: ['INBOX'] }),
      }),
    )
    expect(result).toEqual({ historyId: '12345', expiration: '1234567890000' })
  })

  it('throws with the response body when Gmail rejects the watch request', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({}),
      text: async () => 'Invalid topic name',
    } as Response)

    await expect(registerGmailWatch()).rejects.toThrow('Gmail watch registration failed (400): Invalid topic name')
  })

  it('throws if GMAIL_PUBSUB_TOPIC is not configured', async () => {
    delete process.env.GMAIL_PUBSUB_TOPIC

    await expect(registerGmailWatch()).rejects.toThrow('GMAIL_PUBSUB_TOPIC not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
