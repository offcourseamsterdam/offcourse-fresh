import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verify that an incoming request is genuinely from Slack.
 * Slack signs every request with HMAC-SHA256 using the app's signing secret.
 * We re-compute the signature and compare with timing-safe equality; requests
 * older than 5 minutes are rejected to block replays.
 *
 * Takes the raw body string (not a Request) so the route can read the body
 * once and use it for both verification and parsing. Fails closed when the
 * signing secret is not configured.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim()
  if (!secret || !timestamp || !signature) return false

  // Reject replays older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) return false

  const base = `v0:${timestamp}:${rawBody}`
  const expected = 'v0=' + createHmac('sha256', secret).update(base).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    // timingSafeEqual throws on length mismatch — treat as invalid.
    return false
  }
}
