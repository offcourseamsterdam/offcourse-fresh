import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsappMessage, WhatsappWindowClosedError } from './client'

const ENV_BACKUP = { ...process.env }

beforeEach(() => {
  process.env.TWILIO_ACCOUNT_SID = 'ACxxxx'
  process.env.TWILIO_AUTH_TOKEN = 'secret'
  process.env.TWILIO_WHATSAPP_NUMBER = '+14155238886'
})

afterEach(() => {
  process.env = { ...ENV_BACKUP }
  vi.unstubAllGlobals()
})

describe('sendWhatsappMessage', () => {
  it('POSTs to the Twilio Messages API with whatsapp: prefixed To/From', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SM123' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await sendWhatsappMessage({ to: '+31612345678', body: 'Hi Susanne!' })
    expect(result).toEqual({ id: 'SM123' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://api.twilio.com/2010-04-01/Accounts/ACxxxx/Messages.json')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from('ACxxxx:secret').toString('base64')}`)
    const body = init.body as URLSearchParams
    expect(body.get('To')).toBe('whatsapp:+31612345678')
    expect(body.get('From')).toBe('whatsapp:+14155238886')
    expect(body.get('Body')).toBe('Hi Susanne!')
  })

  it('does not double-prefix an already-prefixed number', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sid: 'SM123' }) })
    vi.stubGlobal('fetch', fetchMock)

    await sendWhatsappMessage({ to: 'whatsapp:+31612345678', body: 'Hi!' })
    const body = fetchMock.mock.calls[0][1].body as URLSearchParams
    expect(body.get('To')).toBe('whatsapp:+31612345678')
  })

  it('throws WhatsappWindowClosedError on Twilio error 63016', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ code: 63016, message: 'Failed to send freeform message...' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendWhatsappMessage({ to: '+31612345678', body: 'Hi!' })).rejects.toBeInstanceOf(WhatsappWindowClosedError)
  })

  it('throws a generic error with Twilio detail for other failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ code: 20003, message: 'Authenticate' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendWhatsappMessage({ to: '+31612345678', body: 'Hi!' })).rejects.toThrow('Twilio 401: Authenticate')
  })

  it('handles a non-JSON error body without throwing a secondary error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendWhatsappMessage({ to: '+31612345678', body: 'Hi!' })).rejects.toThrow('Twilio 500: Internal Server Error')
  })

  it('throws when Twilio env vars are missing', async () => {
    delete process.env.TWILIO_WHATSAPP_NUMBER
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(sendWhatsappMessage({ to: '+31612345678', body: 'Hi!' })).rejects.toThrow('not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
