/**
 * Recognizes GetYourGuide's "you have a new review" notification email and
 * pulls out which product it's for. Grounded in two real emails (2026-08-07),
 * both from the same sender/subject shape but naming different products:
 *
 *   "You have a new review on GetYourGuide - 607167 (126298522)"
 *   "Hi supply partner,\n\nYou have received a new review for your product
 *   Private Canal Cruise Through Amsterdam's Hidden Gems.\n\n..."
 *
 *   "You have a new review on GetYourGuide - 607167 (126095189)"
 *   "...You have received a new review for your product Small Shared Canal
 *   Cruise with Local Captain and Hidden Gems.\n\n..."
 *
 * Never a customer message (it's GetYourGuide's own relay, not a guest) and
 * never something to reply to — same reasoning as the OTA notifications in
 * lib/ota/detect.ts.
 */

const SENDER = 'do-not-reply@notification.getyourguide.com'

export interface GygReviewNotification {
  productName: string
}

export function detectGygReviewNotification(params: {
  fromEmail: string
  subject: string
  bodyText: string
}): GygReviewNotification | null {
  const { fromEmail, subject, bodyText } = params
  if (fromEmail.toLowerCase() !== SENDER) return null
  if (!/You have a new review on GetYourGuide/i.test(subject)) return null

  const productName = bodyText.match(/new review for your product\s+([^.]+)\./i)?.[1]?.trim()
  if (!productName) return null

  return { productName }
}
