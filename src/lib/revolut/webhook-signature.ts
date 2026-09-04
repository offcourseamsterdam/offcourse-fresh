/**
 * Revolut webhooks v2 signature verification.
 *
 * From "Verify the payload signature" (developer.revolut.com, 2026-09-04):
 *   payload_to_sign = "v1." + Revolut-Request-Timestamp + "." + raw body
 *   expected        = "v1=" + hex(HMAC-SHA256(signing_secret, payload_to_sign))
 * The Revolut-Signature header may carry several comma-separated signatures
 * while a rotated secret is still valid; any single match is enough.
 * Reject events whose timestamp is more than 5 minutes from now (replay guard).
 *
 * Pure: no I/O. The raw body must be the exact bytes Revolut sent — never
 * re-serialise the JSON before verifying.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

export const REVOLUT_WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000

export interface VerifyArgs {
  rawBody: string
  signatureHeader: string | null | undefined
  timestampHeader: string | null | undefined
  /** All currently valid signing secrets (current + not-yet-expired rotated ones). */
  secrets: string[]
  now?: Date
  toleranceMs?: number
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'stale_timestamp' | 'no_secret' | 'signature_mismatch' }

export function computeRevolutSignature(secret: string, timestamp: string, rawBody: string): string {
  const payloadToSign = `v1.${timestamp}.${rawBody}`
  return `v1=${createHmac('sha256', secret).update(payloadToSign, 'utf8').digest('hex')}`
}

export function verifyRevolutWebhook(args: VerifyArgs): VerifyResult {
  const { rawBody, signatureHeader, timestampHeader } = args
  if (!signatureHeader || !timestampHeader) return { ok: false, reason: 'missing_headers' }
  const secrets = args.secrets.filter(s => typeof s === 'string' && s.length > 0)
  if (secrets.length === 0) return { ok: false, reason: 'no_secret' }

  const ts = Number(timestampHeader)
  if (!Number.isFinite(ts) || ts <= 0) return { ok: false, reason: 'bad_timestamp' }
  const nowMs = (args.now ?? new Date()).getTime()
  if (Math.abs(nowMs - ts) > (args.toleranceMs ?? REVOLUT_WEBHOOK_TOLERANCE_MS)) return { ok: false, reason: 'stale_timestamp' }

  const provided = signatureHeader.split(',').map(s => s.trim()).filter(Boolean)
  for (const secret of secrets) {
    const expected = computeRevolutSignature(secret, timestampHeader, rawBody)
    for (const sig of provided) {
      if (safeEqual(sig, expected)) return { ok: true }
    }
  }
  return { ok: false, reason: 'signature_mismatch' }
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

// ── Payload shapes (v2) ──────────────────────────────────────────────────────

export interface RevolutWebhookEvent<T = unknown> {
  event: 'TransactionCreated' | 'TransactionStateChanged' | 'PayoutLinkCreated' | 'PayoutLinkStateChanged' | string
  timestamp: string
  data: T
}

export interface TransactionStateChangedData {
  id: string
  old_state: string
  new_state: string
  request_id?: string
}

export interface TransactionCreatedData {
  id: string
  type: string
  state: string
  request_id?: string
  created_at: string
  updated_at: string
  completed_at?: string
  reference?: string
  legs?: unknown[]
}

export function parseRevolutWebhook(rawBody: string): RevolutWebhookEvent | null {
  try {
    const j = JSON.parse(rawBody) as RevolutWebhookEvent
    if (!j || typeof j.event !== 'string' || typeof j.data !== 'object' || j.data === null) return null
    return j
  } catch {
    return null
  }
}

/** Stable key for idempotency: the same delivery (or retry) maps to the same key. */
export function webhookDedupeKey(evt: RevolutWebhookEvent, timestampHeader: string): string {
  const id = (evt.data as { id?: string }).id ?? 'unknown'
  const extra = evt.event === 'TransactionStateChanged' ? `:${(evt.data as TransactionStateChangedData).new_state ?? ''}` : ''
  return `${evt.event}:${id}${extra}:${evt.timestamp || timestampHeader}`
}
