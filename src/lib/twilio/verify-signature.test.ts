import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import { verifyTwilioSignature } from './verify-signature'

const AUTH_TOKEN = '12345'
const URL = 'https://mycompany.com/myapp'
const PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+12349013030',
  Digits: '1234',
  From: '+12349013030',
  To: '+18005551212',
}

/**
 * Twilio's own algorithm, computed independently of the `twilio` package —
 * sort param keys, append key+value pairs to the URL, HMAC-SHA1 with the
 * auth token, base64. Cross-checks that verifyTwilioSignature() actually
 * agrees with the documented spec, not just "whatever the library returns".
 */
function computeSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

describe('verifyTwilioSignature', () => {
  it('accepts a signature computed per Twilio\'s documented algorithm', () => {
    const signature = computeSignature(URL, PARAMS, AUTH_TOKEN)
    expect(verifyTwilioSignature(URL, PARAMS, signature, AUTH_TOKEN)).toBe(true)
  })

  it('rejects when a param value was tampered with after signing', () => {
    const signature = computeSignature(URL, PARAMS, AUTH_TOKEN)
    const tampered = { ...PARAMS, Digits: '9999' }
    expect(verifyTwilioSignature(URL, tampered, signature, AUTH_TOKEN)).toBe(false)
  })

  it('rejects when the URL differs from what was signed (e.g. trailing slash)', () => {
    const signature = computeSignature(URL, PARAMS, AUTH_TOKEN)
    expect(verifyTwilioSignature(`${URL}/`, PARAMS, signature, AUTH_TOKEN)).toBe(false)
  })

  it('rejects the wrong auth token', () => {
    const signature = computeSignature(URL, PARAMS, AUTH_TOKEN)
    expect(verifyTwilioSignature(URL, PARAMS, signature, 'wrong-token')).toBe(false)
  })

  it('fails closed when the signature header is missing', () => {
    expect(verifyTwilioSignature(URL, PARAMS, null, AUTH_TOKEN)).toBe(false)
  })

  it('fails closed when the auth token is not configured', () => {
    const signature = computeSignature(URL, PARAMS, AUTH_TOKEN)
    expect(verifyTwilioSignature(URL, PARAMS, signature, '')).toBe(false)
  })
})
