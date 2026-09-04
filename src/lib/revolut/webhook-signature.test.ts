import { describe, it, expect } from 'vitest'
import { computeRevolutSignature, parseRevolutWebhook, verifyRevolutWebhook, webhookDedupeKey } from './webhook-signature'

// Revolut's own published test vector ("Verify the payload signature" guide).
const SECRET = 'wsk_r59a4HfWVAKycbCaNO1RvgCJec02gRd8'
const TIMESTAMP = '1683650202360'
const BODY = '{"data":{"id":"645a7696-22f3-aa47-9c74-cbae0449cc46","new_state":"completed","old_state":"pending","request_id":"app_charges-9f5d5eb3-1e06-46c5-b1c0-3914763e0bcb"},"event":"TransactionStateChanged","timestamp":"2023-05-09T16:36:38.028960Z"}'
const SIGNATURE = 'v1=bca326fb378d0da7f7c490ad584a8106bab9723d8d9cdd0d50b4c5b3be3837c0'
const NOW = new Date(Number(TIMESTAMP) + 10_000)

describe('computeRevolutSignature', () => {
  it('reproduces Revolut\'s published test vector exactly', () => {
    expect(computeRevolutSignature(SECRET, TIMESTAMP, BODY)).toBe(SIGNATURE)
  })
})

describe('verifyRevolutWebhook', () => {
  const base = { rawBody: BODY, signatureHeader: SIGNATURE, timestampHeader: TIMESTAMP, secrets: [SECRET], now: NOW }

  it('accepts a valid signature inside the time window', () => {
    expect(verifyRevolutWebhook(base)).toEqual({ ok: true })
  })

  it('accepts when one of several comma-separated signatures matches (secret rotation)', () => {
    expect(verifyRevolutWebhook({ ...base, signatureHeader: `v1=deadbeef,${SIGNATURE}` })).toEqual({ ok: true })
    expect(verifyRevolutWebhook({ ...base, secrets: ['old-secret', SECRET] })).toEqual({ ok: true })
  })

  it('rejects a tampered body', () => {
    expect(verifyRevolutWebhook({ ...base, rawBody: BODY.replace('completed', 'declined') })).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects a re-serialised body (whitespace changes the signature)', () => {
    const pretty = JSON.stringify(JSON.parse(BODY), null, 2)
    expect(verifyRevolutWebhook({ ...base, rawBody: pretty })).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects the wrong secret', () => {
    expect(verifyRevolutWebhook({ ...base, secrets: ['wsk_wrong'] })).toEqual({ ok: false, reason: 'signature_mismatch' })
  })

  it('rejects missing headers and missing secrets', () => {
    expect(verifyRevolutWebhook({ ...base, signatureHeader: null })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(verifyRevolutWebhook({ ...base, timestampHeader: undefined })).toEqual({ ok: false, reason: 'missing_headers' })
    expect(verifyRevolutWebhook({ ...base, secrets: [] })).toEqual({ ok: false, reason: 'no_secret' })
  })

  it('rejects a timestamp outside the 5-minute window (replay guard), either direction', () => {
    expect(verifyRevolutWebhook({ ...base, now: new Date(Number(TIMESTAMP) + 6 * 60_000) })).toEqual({ ok: false, reason: 'stale_timestamp' })
    expect(verifyRevolutWebhook({ ...base, now: new Date(Number(TIMESTAMP) - 6 * 60_000) })).toEqual({ ok: false, reason: 'stale_timestamp' })
    expect(verifyRevolutWebhook({ ...base, now: new Date(Number(TIMESTAMP) + 4 * 60_000) })).toEqual({ ok: true })
  })

  it('rejects a non-numeric timestamp', () => {
    expect(verifyRevolutWebhook({ ...base, timestampHeader: 'yesterday' })).toEqual({ ok: false, reason: 'bad_timestamp' })
  })
})

describe('parseRevolutWebhook + dedupe key', () => {
  it('parses a v2 event', () => {
    const evt = parseRevolutWebhook(BODY)
    expect(evt?.event).toBe('TransactionStateChanged')
    expect((evt?.data as { id: string }).id).toBe('645a7696-22f3-aa47-9c74-cbae0449cc46')
  })
  it('returns null for garbage', () => {
    expect(parseRevolutWebhook('not json')).toBeNull()
    expect(parseRevolutWebhook('{"event":1}')).toBeNull()
  })
  it('dedupe key is stable across retries and distinguishes state changes', () => {
    const evt = parseRevolutWebhook(BODY)!
    const k1 = webhookDedupeKey(evt, TIMESTAMP)
    const k2 = webhookDedupeKey(parseRevolutWebhook(BODY)!, '9999')
    expect(k1).toBe(k2)
    expect(k1).toContain(':completed:')
    const declined = parseRevolutWebhook(BODY.replace('"new_state":"completed"', '"new_state":"declined"'))!
    expect(webhookDedupeKey(declined, TIMESTAMP)).not.toBe(k1)
  })
})
