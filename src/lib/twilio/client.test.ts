import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { normalizePhoneNumber, sendTwilioSms } from './client'

describe('normalizePhoneNumber', () => {
  it('normalizes Dutch mobile numbers starting with 06 to +316', () => {
    expect(normalizePhoneNumber('0612345678')).toBe('+31612345678')
    expect(normalizePhoneNumber('06 12 34 56 78')).toBe('+31612345678')
    expect(normalizePhoneNumber('06-12345678')).toBe('+31612345678')
  })

  it('normalizes numbers starting with 00 to +', () => {
    expect(normalizePhoneNumber('0031612345678')).toBe('+31612345678')
    expect(normalizePhoneNumber('0015552345678')).toBe('+15552345678')
  })

  it('normalizes formatted international E.164 numbers', () => {
    expect(normalizePhoneNumber('+31 6 1234 5678')).toBe('+31612345678')
    expect(normalizePhoneNumber('+1 (555) 234-5678')).toBe('+15552345678')
    expect(normalizePhoneNumber('+44 7911 123456')).toBe('+447911123456')
  })

  it('normalizes US numbers without + prefix', () => {
    expect(normalizePhoneNumber('12816029365')).toBe('+12816029365')
    expect(normalizePhoneNumber('2816029365')).toBe('+12816029365')
  })

  it('returns null for invalid or empty numbers', () => {
    expect(normalizePhoneNumber('')).toBeNull()
    expect(normalizePhoneNumber('invalid-phone')).toBeNull()
    expect(normalizePhoneNumber('123')).toBeNull()
  })
})

describe('sendTwilioSms', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  it('returns mock response when Twilio credentials are missing', async () => {
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_AUTH_TOKEN

    const result = await sendTwilioSms({
      to: '+31612345678',
      body: 'Hello test message',
    })

    expect(result.success).toBe(true)
    expect(result.mock).toBe(true)
    expect(result.sid).toMatch(/^mock_/)
  })

  it('returns error when phone number cannot be normalized', async () => {
    const result = await sendTwilioSms({
      to: 'not-a-phone',
      body: 'Hello test message',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Invalid phone number')
  })

  it('calls Twilio API when credentials are provided', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest123456789'
    process.env.TWILIO_AUTH_TOKEN = 'authtoken123456'
    process.env.TWILIO_FROM_NUMBER = '+15550001111'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sid: 'SM1234567890abcdef', status: 'queued' }),
    })
    global.fetch = fetchMock as any

    const result = await sendTwilioSms({
      to: '0612345678',
      body: 'Thanks for cruising!',
    })

    expect(result.success).toBe(true)
    expect(result.sid).toBe('SM1234567890abcdef')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACtest123456789/Messages.json')
    expect(options.method).toBe('POST')
    expect(options.headers.Authorization).toBe(
      `Basic ${Buffer.from('ACtest123456789:authtoken123456').toString('base64')}`
    )
    expect(options.body).toContain('To=%2B31612345678')
    expect(options.body).toContain('From=%2B15550001111')
    expect(options.body).toContain('Body=Thanks+for+cruising%21')
  })

  it('handles Twilio API errors gracefully', async () => {
    process.env.TWILIO_ACCOUNT_SID = 'ACtest123456789'
    process.env.TWILIO_AUTH_TOKEN = 'authtoken123456'

    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ code: 21211, message: 'The "To" number is not valid' }),
    })
    global.fetch = fetchMock as any

    const result = await sendTwilioSms({
      to: '+31612345678',
      body: 'Hello',
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('The "To" number is not valid')
  })
})
