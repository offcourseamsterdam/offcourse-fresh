import { describe, it, expect } from 'vitest'
import { detectGygReviewNotification } from './detect-review-notification'

const SENDER = 'do-not-reply@notification.getyourguide.com'

/** Minimal real fragment (2026-08-21) — the star badge is an <img alt="N stars">, never plain text. */
const FIVE_STAR_HTML = '<img src="https://cdn.braze.eu/appboy/communication/assets/image_assets/images/x.png" alt="5 stars" style="display:inline">'

describe('detectGygReviewNotification', () => {
  it('detects a real review notification and extracts product, rating, review text, and external id (Private Canal Cruise example, 2026-08-07)', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (126298522)',
      bodyText:
        "Hi supply partner,\n\nYou have received a new review for your product Private Canal Cruise Through Amsterdam's Hidden Gems.\n\nCalming route, amazing and kind host Beer and beautiful waters :)Reply to review",
      bodyHtml: FIVE_STAR_HTML,
    })
    expect(result).toEqual({
      productName: "Private Canal Cruise Through Amsterdam's Hidden Gems",
      externalReviewId: '126298522',
      rating: 5,
      reviewText: 'Calming route, amazing and kind host Beer and beautiful waters :)',
    })
  })

  it('detects a real review notification for a different product (Small Shared Canal Cruise example, 2026-08-21)', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (126695754)',
      bodyText:
        'Hi supply partner,\n\nYou have received a new review for your product Small Shared Canal Cruise with Local Captain and Hidden Gems.\n\nOur guide Joshua was very friendly, knowledgeable and interesting. We really enjoyed the trip.Reply to reviewExplore your customer ratings data in your analytics dashboard.',
      bodyHtml: FIVE_STAR_HTML,
    })
    expect(result).toEqual({
      productName: 'Small Shared Canal Cruise with Local Captain and Hidden Gems',
      externalReviewId: '126695754',
      rating: 5,
      reviewText: 'Our guide Joshua was very friendly, knowledgeable and interesting. We really enjoyed the trip.',
    })
  })

  it('is null for an email from a different sender, even with matching subject/body text', () => {
    const result = detectGygReviewNotification({
      fromEmail: 'someone@example.com',
      subject: 'You have a new review on GetYourGuide - 607167 (1)',
      bodyText: 'You have received a new review for your product Foo.',
      bodyHtml: FIVE_STAR_HTML,
    })
    expect(result).toBeNull()
  })

  it('is null for a GetYourGuide email that is not a review notification (e.g. a booking-related email)', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'New booking confirmed',
      bodyText: 'A guest just booked your Private Canal Cruise.',
      bodyHtml: FIVE_STAR_HTML,
    })
    expect(result).toBeNull()
  })

  it('is null when the product name cannot be extracted from the body', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (1)',
      bodyText: 'Hi supply partner,\n\nSomething changed about your reviews.',
      bodyHtml: FIVE_STAR_HTML,
    })
    expect(result).toBeNull()
  })

  it('is null when the subject has no trailing review id in parentheses', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide',
      bodyText: 'You have received a new review for your product Foo Cruise.\n\nGreat trip!Reply to review',
      bodyHtml: FIVE_STAR_HTML,
    })
    expect(result).toBeNull()
  })

  it('is null when there is no HTML part at all — the rating never appears in plain text, so there is nothing to fall back to', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (126298522)',
      bodyText: 'You have received a new review for your product Foo Cruise.\n\nGreat trip!Reply to review',
      bodyHtml: null,
    })
    expect(result).toBeNull()
  })

  it('is null when the HTML has no star badge at all', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (126298522)',
      bodyText: 'You have received a new review for your product Foo Cruise.\n\nGreat trip!Reply to review',
      bodyHtml: '<p>no rating image here</p>',
    })
    expect(result).toBeNull()
  })

  it('rejects an out-of-range parsed rating rather than trusting a malformed alt text', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (126298522)',
      bodyText: 'You have received a new review for your product Foo Cruise.\n\nGreat trip!Reply to review',
      bodyHtml: '<img alt="9 stars">',
    })
    expect(result).toBeNull()
  })

  it('is null when the review text cannot be isolated (no "Reply to review" boundary found)', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (126298522)',
      bodyText: 'You have received a new review for your product Foo Cruise.\n\n',
      bodyHtml: FIVE_STAR_HTML,
    })
    expect(result).toBeNull()
  })
})
