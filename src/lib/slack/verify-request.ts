import { createHmac, timingSafeEqual } from 'crypto'

/**
 * Verify that an incoming request is genuinely from Slack.
 * Slack signs every request with HMAC-SHA256 using the app's signing secret.
 * We re-compute the signature and compare with timing-safe equality to prevent
 * replay attacks (requests older than 5 minutes are rejected).
 */
export async function verifySlackRequest(req: Request): Promise<boolean> {
  const secret = process.env.SLACK_SIGNING_SECRET
  if (!secret) return false

  const timestamp = req.headers.get('x-slack-request-timestamp')
  const signature = req.headers.get('x-slack-signature')
  if (!timestamp || !signature) return false

  // Reject replays older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (age > 300) return false

  const body = await req.text()
  const base = `v0:${timestamp}:${body}`
  const expected = 'v0=' + createHmac('sha256', secret).update(base).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  } catch {
    return false
  }
}
