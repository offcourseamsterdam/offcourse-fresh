import { createHmac, timingSafeEqual } from 'crypto'

/**
 * HMAC token for the public guest-move response page. Mirrors the stock-count
 * token (src/lib/stock/stock-token.ts), but signs the PROPOSAL ID so every
 * move request gets its own unguessable link — a leaked link only ever exposes
 * that one guest's offer.
 *
 * Low-stakes by design: the worst a leaked link allows is answering someone
 * else's move request, and the actual rebooking stays a human admin action.
 * Rotate by changing GUEST_MOVE_TOKEN_SECRET (open links stop working).
 */

const MOVE_SCOPE = 'guest-move'

function secret() {
  return process.env.GUEST_MOVE_TOKEN_SECRET ?? process.env.REVALIDATION_SECRET ?? 'dev-fallback'
}

export function generateMoveToken(proposalId: string): string {
  return createHmac('sha256', secret()).update(`${MOVE_SCOPE}:${proposalId}`).digest('hex').slice(0, 32)
}

/** Re-derive the expected token and compare in constant time. */
export function isValidMoveToken(proposalId: string, token: string): boolean {
  const expected = Buffer.from(generateMoveToken(proposalId))
  const given = Buffer.from(token ?? '')
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

/** Full public URL the guest taps in the SMS / email button. */
export function moveResponseUrl(baseUrl: string, proposalId: string): string {
  return `${baseUrl}/en/move/${proposalId}/${generateMoveToken(proposalId)}`
}
