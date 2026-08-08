import { describe, it, expect } from 'vitest'
import { detectGygReviewNotification } from './detect-review-notification'

const SENDER = 'do-not-reply@notification.getyourguide.com'

describe('detectGygReviewNotification', () => {
  it('detects a real review notification and extracts the product name (Private Canal Cruise example)', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (126298522)',
      bodyText:
        "Hi supply partner,\n\nYou have received a new review for your product Private Canal Cruise Through Amsterdam's Hidden Gems.\n\nCalming route, amazing and kind host Beer and beautiful waters :)Reply to review",
    })
    expect(result).toEqual({ productName: "Private Canal Cruise Through Amsterdam's Hidden Gems" })
  })

  it('detects a real review notification for a different product (Small Shared Canal Cruise example)', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (126095189)',
      bodyText:
        'Hi supply partner,\n\nYou have received a new review for your product Small Shared Canal Cruise with Local Captain and Hidden Gems.\n\nHighly informative and personalised',
    })
    expect(result).toEqual({ productName: 'Small Shared Canal Cruise with Local Captain and Hidden Gems' })
  })

  it('is null for an email from a different sender, even with matching subject/body text', () => {
    const result = detectGygReviewNotification({
      fromEmail: 'someone@example.com',
      subject: 'You have a new review on GetYourGuide - 607167 (1)',
      bodyText: 'You have received a new review for your product Foo.',
    })
    expect(result).toBeNull()
  })

  it('is null for a GetYourGuide email that is not a review notification (e.g. a booking-related email)', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'New booking confirmed',
      bodyText: 'A guest just booked your Private Canal Cruise.',
    })
    expect(result).toBeNull()
  })

  it('is null when the product name cannot be extracted from the body', () => {
    const result = detectGygReviewNotification({
      fromEmail: SENDER,
      subject: 'You have a new review on GetYourGuide - 607167 (1)',
      bodyText: 'Hi supply partner,\n\nSomething changed about your reviews.',
    })
    expect(result).toBeNull()
  })
})
