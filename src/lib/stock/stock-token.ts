import { createHmac, timingSafeEqual } from 'crypto'

/**
 * HMAC token for the public stock-count QR page. Mirrors the extras-upsell
 * token (src/lib/booking/extras-token.ts): a constant-time-comparable, 32-char
 * hex digest derived from a fixed payload + a server secret. There is one
 * global QR for the storage room, so the token signs a constant string.
 *
 * Low-stakes by design: the worst a leaked QR allows is fudging a count, and
 * every reorder it triggers is still a human-approved shadow proposal. Rotate
 * by changing STOCK_TOKEN_SECRET (old printed QRs stop working).
 */

const STOCK_SCOPE = 'stock-count'

function secret() {
  return process.env.STOCK_TOKEN_SECRET ?? process.env.REVALIDATION_SECRET ?? 'dev-fallback'
}

/** The single stock-count token (HMAC of a fixed scope string). */
export function generateStockToken(): string {
  return createHmac('sha256', secret()).update(STOCK_SCOPE).digest('hex').slice(0, 32)
}

/** Re-derive the expected token and compare in constant time. */
export function isValidStockToken(token: string): boolean {
  const expected = Buffer.from(generateStockToken())
  const given = Buffer.from(token ?? '')
  // timingSafeEqual throws on length mismatch — a length difference is already a
  // mismatch, so treat it as invalid without leaking timing on equal-length inputs.
  if (expected.length !== given.length) return false
  return timingSafeEqual(expected, given)
}

/** Full public URL for the storage-room QR (printed and stuck in the box). */
export function stockCountUrl(baseUrl: string): string {
  return `${baseUrl}/en/stock/${generateStockToken()}`
}
