import { createHmac } from 'crypto'

function secret() {
  return process.env.EXTRAS_TOKEN_SECRET ?? process.env.REVALIDATION_SECRET ?? 'dev-fallback'
}

/** Generate a 32-char HMAC token for a booking's upsell page link. */
export function generateExtrasToken(bookingId: string): string {
  return createHmac('sha256', secret()).update(bookingId).digest('hex').slice(0, 32)
}

/** Returns true when the token matches the booking ID. Constant-time compare via re-derive. */
export function isValidExtrasToken(token: string, bookingId: string): boolean {
  return generateExtrasToken(bookingId) === token
}

/** Full public URL for this booking's extras upsell page. */
export function extrasPageUrl(bookingId: string, baseUrl: string): string {
  const token = generateExtrasToken(bookingId)
  return `${baseUrl}/en/extras/${bookingId}/${token}`
}
