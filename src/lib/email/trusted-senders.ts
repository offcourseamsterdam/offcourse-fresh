/**
 * Email domains known to be a real platform partner, not an arbitrary
 * sender — safe to render an email's remote images for (see
 * SafeEmailHtml's trustSender, and sanitize-html.ts's tracking-pixel
 * defense this opts out of). Grown one real domain at a time: getyourguide's
 * review notifications are the first case that actually needed this (their
 * star-rating graphic and logo are remote images with no data: fallback).
 */
const TRUSTED_SENDER_DOMAINS = ['getyourguide.com']

export function isTrustedEmailSender(email: string | null | undefined): boolean {
  if (!email) return false
  const domain = email.toLowerCase().split('@')[1]
  return !!domain && TRUSTED_SENDER_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))
}
