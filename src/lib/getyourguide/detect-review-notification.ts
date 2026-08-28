/**
 * Recognizes GetYourGuide's "you have a new review" notification email and
 * pulls out everything a `social_proof_reviews` row needs — product, star
 * rating, review text, and a stable external id — so the review can be
 * ingested the moment the email arrives, without waiting for the (currently
 * Cloudflare-blocked) weekly scraper. Grounded in real emails (2026-08-07
 * and 2026-08-21), all from the same sender/subject shape:
 *
 *   "You have a new review on GetYourGuide - 607167 (126298522)"
 *   "Hi supply partner,\n\nYou have received a new review for your product
 *   Private Canal Cruise Through Amsterdam's Hidden Gems.\n\nCalming route,
 *   amazing and kind host Beer and beautiful waters :)Reply to review"
 *
 *   "You have a new review on GetYourGuide - 607167 (126695754)"
 *   "...for your product Small Shared Canal Cruise with Local Captain and
 *   Hidden Gems.\n\nOur guide Joshua was very friendly, knowledgeable and
 *   interesting. We really enjoyed the trip.Reply to review..."
 *
 * Never a customer message (it's GetYourGuide's own relay, not a guest) and
 * never something to reply to — same reasoning as the OTA notifications in
 * lib/ota/detect.ts.
 *
 * "607167" is OUR OWN GetYourGuide supplier id (constant across every email,
 * matches the "Supplier ID: 607167" footer) — the number in the *subject's*
 * parentheses is the actual per-review id, confirmed by 4 real examples all
 * sharing 607167 but each with a distinct trailing number.
 */

// Exported so the inbox list can recognize this sender for its own display
// purposes (a "New review" label) without duplicating the address — see
// ConversationList.tsx's requestTypeLabel.
export const GYG_REVIEW_NOTIFICATION_SENDER = 'do-not-reply@notification.getyourguide.com'

export interface GygReviewNotification {
  productName: string
  externalReviewId: string
  /**
   * 1-5, parsed from an `<img alt="5 stars">` badge in the HTML part — the
   * plain-text body never mentions the rating at all. ONLY grounded in a real
   * 5-star example; the singular/plural regex (`stars?`) is an assumption for
   * a 1-star badge, not yet verified against a real one.
   */
  rating: number
  reviewText: string
}

export function detectGygReviewNotification(params: {
  fromEmail: string
  subject: string
  bodyText: string
  /** The email's HTML part — only place the star rating actually appears. Null (e.g. a plain-text-only fetch) → detection fails; there is no plain-text fallback for a rating GetYourGuide never puts in the text part. */
  bodyHtml: string | null
}): GygReviewNotification | null {
  const { fromEmail, subject, bodyText, bodyHtml } = params
  if (fromEmail.toLowerCase() !== GYG_REVIEW_NOTIFICATION_SENDER) return null
  if (!/You have a new review on GetYourGuide/i.test(subject)) return null

  const productName = bodyText.match(/new review for your product\s+([^.]+)\./i)?.[1]?.trim()
  if (!productName) return null

  const externalReviewId = subject.match(/\((\d+)\)\s*$/)?.[1]
  if (!externalReviewId) return null

  const rating = bodyHtml ? Number(bodyHtml.match(/alt="(\d)\s*stars?"/i)?.[1]) : NaN
  if (!rating || rating < 1 || rating > 5) return null

  // The review text sits between "product {name}." and the "Reply to review"
  // button label — stripHtml() concatenates the button text directly onto it
  // with no separating whitespace (see the grounded examples above), so that
  // literal string is the only reliable right-hand boundary.
  const afterProduct = bodyText.split(`${productName}.`)[1] ?? ''
  const reviewText = afterProduct.split('Reply to review')[0]?.trim()
  if (!reviewText) return null

  return { productName, externalReviewId, rating, reviewText }
}
