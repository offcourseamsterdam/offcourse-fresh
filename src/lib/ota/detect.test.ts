import { describe, it, expect } from 'vitest'
import { detectOtaEmail } from './detect'

// Real email bodies (trimmed to the parts the regexes read), captured from
// actual inbox messages ingested 2026-08-03 — see docs/features/ota-notifications.md.

const WITHLOCALS_REQUEST_BODY = `Hi Beer & Jannah,\r
Great news! You received a new booking request from . The guest is now waiting for your confirmation. The request stays valid for only 48 hours, so make sure you respond in time.\r
\r
Booking details\r
Booking reference\r
39f8dc7a\r
Date & time\r
Thursday, September 24, 2026 at 10:30\r
\r
 \r
Experience\r
Private Canal Cruise with Local Captains and Hidden Gems\r
Number of guests\r
2\r
\r
Price details\r
Total price\r
€315.00\r
`

const WITHLOCALS_CONFIRMATION_BODY = `Hi Beer & Jannah,\r
Congratulations! Here is your booking confirmation for Private Canal Cruise with Local Captains and Hidden Gems on 10:30, 24 September 2026, booked by Mark. You can find all the details below.\r
\r
Booking details\r
Booking reference\r
39f8dc7a\r
Date & time\r
24 September 2026\r
\r
 \r
Experience\r
Private Canal Cruise with Local Captains and Hidden Gems\r
Number of guests\r
2\r
`

const WITHLOCALS_INVOICE_BODY = `Hi Beer & Jannah,\r
Your booking has been invoiced.\r
\r
Please find attached the invoice for booking 39f8dc7a.\r
`

// FareHarbor's own outbound notification — captured verbatim (2026-08-04) from
// the actual stored Gmail message body for booking #369057638, sent to
// messages@fareharbor.com's subscribers because a 3rd-party API (GetYourGuide)
// created this booking directly in FareHarbor. Kept messy on purpose (blank
// lines, indentation, the real non-breaking space in "2 Adults") — this is
// what an HTML FareHarbor email actually looks like once stripped to text,
// not a cleaned-up approximation.
const FAREHARBOR_NEW_BOOKING_GETYOURGUIDE_BODY = `Off Course\r
\r
New Booking for \r
                          Shared Cruise\r
\r
View on FareHarbor &raquo;\r
\r
Created by:\r
                        GetYourGuide API\r
                          (GetYourGuide - EUR - API)\r
                      \r
Created at:\r
                      4/8/2026 @ 12:00\r
\r
Booking #369057638\r
\r
Booking note: #### Comments:\r
\r
\r
#### Customers:\r
shoshana mccallum (📞 +64(0)212480388)\r
\r
Shared Cruise\r
\r
                    Wednesday, 5 August 2026 @ 17:00 - 18:30\r
\r
                        2 Adults\r
\r
                    Name: shoshana mccallum\r
\r
                      Phone: +64 21 248 0388\r
\r
                      Email: customer-xzxhygwncrx37du3@reply.getyourguide.com\r
\r
                      Affiliate\r
\r
                        Affiliate: GetYourGuide - EUR - API\r
\r
                          Voucher: GYGVN25HB255\r
`

// Real capture, 2026-08-05 (Stefaan Vandist, FH booking #369247385) — the
// "Created by" line names Off Course's own legal entity ("Zoomers B.V. API"),
// and the "Voucher" is our own Stripe PaymentIntent id, not a platform code.
const FAREHARBOR_NEW_BOOKING_BOATLOCAL_BODY = `Off Course\r
\r
New Booking for \r
                          Shared Cruise\r
\r
View on FareHarbor &raquo;\r
\r
Created by:\r
                        Zoomers B.V. API\r
                          (Boat Local - API)\r
                      \r
Created at:\r
                      4/8/2026 @ 23:11\r
\r
Booking #369247385\r
\r
Shared Cruise\r
\r
                    Thursday, 6 August 2026 @ 17:00 - 18:30\r
\r
                        2 Adults, 1 Child (0-12)\r
\r
                    Name: Stefaan Vandist\r
\r
                      Phone: +32 496 60 93 01\r
\r
                      Email: mail@stefaanvandist.eu\r
\r
                      Affiliate\r
\r
                        Affiliate: Boat Local - API\r
\r
                          Voucher: pi_3U0pbNGh1qCF71Ta0pKRNwmw\r
`

// Real capture, 2026-08-14 (Jason Tully, FH booking #372067461) — Viator's
// affiliate name is "TripAdvisor Experiences/Viator - EUR - API", not a bare
// "Viator", which is why platformFromAffiliate matches on either substring.
const FAREHARBOR_NEW_BOOKING_VIATOR_BODY = `Off Course\r
\r
New Booking for \r
                          Shared Cruise\r
\r
View on FareHarbor &raquo;\r
\r
Created by:\r
                        Viator-API\r
                          (TripAdvisor Experiences/Viator - EUR - API)\r
                      \r
Created at:\r
                      14/8/2026 @ 19:53\r
\r
Booking #372067461\r
\r
Booking note: #### Customers: Jason Tully, Passenger Two GUIDE\r
\r
Shared Cruise\r
\r
                    Monday, 17 August 2026 @ 17:00 - 18:30\r
\r
                        2 Adults + Unlimited Drinks\r
\r
                    Name: Jason Tully\r
\r
                      Phone: +1 404-394-6447\r
\r
                      Email: S-1a4dd43dab0d45aeb673337992bba328+1436673491-3912gzwelojp6@expmessaging.tripadvisor.com\r
\r
                      Affiliate\r
\r
                        Affiliate: TripAdvisor Experiences/Viator - EUR - API\r
\r
                          Voucher: 1436673491\r
`

const GETMYBOAT_REQUEST_BODY = `NEW BOOKING REQUEST\r
dasd is actively comparing boats, other owners have already been contacted.\r
\r
Responding within 1 hour can increase your chances of booking by 30%.\r
\r
Listing: "Amsterdam Canal Cruise: Float Like a Local on Diana"\r
Date: 8 Aug 2026 - 8 Aug 2026\r
Time: 09:00 a.m. - 11:00 a.m.\r
Duration: 2 hours\r
Group Size: 2 Guests\r
With Captain: Your payment includes the captain's services.\r
`

describe('detectOtaEmail — Withlocals', () => {
  it('recognizes a "New booking request received" email and extracts the booking details', () => {
    const result = detectOtaEmail({
      fromEmail: 'info@withlocals.com',
      subject: 'New booking request received from .',
      bodyText: WITHLOCALS_REQUEST_BODY,
    })
    expect(result).toEqual({
      platform: 'withlocals',
      kind: 'new_request',
      bookingRef: '39f8dc7a',
      guestName: null,
      guestEmail: null,
      guestPhone: null,
      endTime: null,
      stripePaymentIntentId: null,
      parsed: {
        date: 'Thursday, September 24, 2026 at 10:30',
        time: null,
        dateISO: '2026-09-24',
        guests: 2,
        experienceName: 'Private Canal Cruise with Local Captains and Hidden Gems',
        estimatedPriceCents: 31500,
        estimatedCommissionCents: 6300,
      },
    })
  })

  it('recognizes a real "Booking confirmation from {name}" email as kind=confirmed (2026-08-04 — replaces the old guessed "booking confirmed" pattern, which this real email does not match)', () => {
    const result = detectOtaEmail({
      fromEmail: 'notifications@withlocals.com',
      subject: 'Booking confirmation from Mark',
      bodyText: WITHLOCALS_CONFIRMATION_BODY,
    })
    expect(result).toEqual({
      platform: 'withlocals',
      kind: 'confirmed',
      bookingRef: '39f8dc7a',
      guestName: null,
      guestEmail: null,
      guestPhone: null,
      endTime: null,
      stripePaymentIntentId: null,
      parsed: {
        date: '24 September 2026',
        time: null,
        dateISO: '2026-09-24',
        guests: 2,
        experienceName: 'Private Canal Cruise with Local Captains and Hidden Gems',
        estimatedPriceCents: null,
        estimatedCommissionCents: null,
      },
    })
  })

  it('recognizes a real "New invoice for booking #{ref}." email — groups via bookingRef but is not itself an actionable kind', () => {
    const result = detectOtaEmail({
      fromEmail: 'notifications@withlocals.com',
      subject: 'New invoice for booking #39f8dc7a.',
      bodyText: WITHLOCALS_INVOICE_BODY,
    })
    expect(result?.platform).toBe('withlocals')
    expect(result?.kind).toBe('other')
    expect(result?.bookingRef).toBe('39f8dc7a')
  })

  it('returns null for a withlocals.com sender that matches neither known pattern', () => {
    const result = detectOtaEmail({
      fromEmail: 'info@withlocals.com',
      subject: 'Your monthly payout statement',
      bodyText: 'Here is your statement.',
    })
    expect(result).toBeNull()
  })
})

describe('detectOtaEmail — GetMyBoat', () => {
  it('recognizes a "NEW BOOKING REQUEST" email and extracts the guest name + listing details', () => {
    const result = detectOtaEmail({
      fromEmail: 'support@getmyboat.com',
      subject: 'RE: Inquiry for 8 Aug 2026 "Amsterdam Canal Cruise: Float Like a Local on Diana…"',
      bodyText: GETMYBOAT_REQUEST_BODY,
    })
    expect(result).toEqual({
      platform: 'getmyboat',
      kind: 'new_request',
      bookingRef: null, // GetMyBoat exposes no clean reference — falls back to thread-based grouping.
      guestName: 'dasd',
      guestEmail: null,
      guestPhone: null,
      endTime: null,
      stripePaymentIntentId: null,
      parsed: {
        date: '8 Aug 2026 - 8 Aug 2026',
        time: '09:00 a.m. - 11:00 a.m.',
        dateISO: '2026-08-08',
        guests: 2,
        experienceName: 'Amsterdam Canal Cruise: Float Like a Local on Diana',
      },
    })
  })

  it('returns null for a getmyboat.com sender whose body has none of the known markers', () => {
    const result = detectOtaEmail({
      fromEmail: 'support@getmyboat.com',
      subject: 'Your account settings changed',
      bodyText: 'We noticed a change to your account.',
    })
    expect(result).toBeNull()
  })
})

describe('detectOtaEmail — FareHarbor notification', () => {
  it('recognizes a real "New Booking ... Created by: GetYourGuide API" notification as kind=needs_import', () => {
    const result = detectOtaEmail({
      fromEmail: 'messages@fareharbor.com',
      subject: 'New booking for Shared Cruise',
      bodyText: FAREHARBOR_NEW_BOOKING_GETYOURGUIDE_BODY,
    })
    expect(result).toEqual({
      platform: 'getyourguide',
      kind: 'needs_import',
      bookingRef: '369057638',
      guestName: 'shoshana mccallum',
      guestEmail: 'customer-xzxhygwncrx37du3@reply.getyourguide.com',
      guestPhone: '+64 21 248 0388',
      endTime: '18:30',
      stripePaymentIntentId: null,
      parsed: {
        date: '5 August 2026',
        time: '17:00',
        dateISO: '2026-08-05',
        guests: 2,
        experienceName: 'Shared Cruise',
        estimatedPriceCents: 7500,
        estimatedCommissionCents: 1500,
      },
    })
  })

  it('recognizes a real "New Booking ... Created by: Zoomers B.V. API (Boat Local - API)" notification as kind=own_channel, with the Voucher read as our own Stripe PaymentIntent id', () => {
    const result = detectOtaEmail({
      fromEmail: 'messages@fareharbor.com',
      subject: 'New booking for Shared Cruise',
      bodyText: FAREHARBOR_NEW_BOOKING_BOATLOCAL_BODY,
    })
    expect(result).toEqual({
      platform: 'boatlocal',
      kind: 'own_channel',
      bookingRef: '369247385',
      guestName: 'Stefaan Vandist',
      guestEmail: 'mail@stefaanvandist.eu',
      guestPhone: '+32 496 60 93 01',
      endTime: '18:30',
      stripePaymentIntentId: 'pi_3U0pbNGh1qCF71Ta0pKRNwmw',
      parsed: {
        date: '6 August 2026',
        time: '17:00',
        dateISO: '2026-08-06',
        guests: 2,
        experienceName: 'Shared Cruise',
        estimatedPriceCents: 7500,
        estimatedCommissionCents: 1125,
      },
    })
  })

  it('recognizes a Boat Local notification whose Voucher is NOT a Stripe PaymentIntent id as kind=needs_import, not own_channel — a genuine boatlocal.nl booking, not our own website checkout echoed back (grounded 2026-08-21: James Hagler, FH #372322392, Voucher a plain UUID)', () => {
    const bodyWithUuidVoucher = FAREHARBOR_NEW_BOOKING_BOATLOCAL_BODY.replace(
      'Voucher: pi_3U0pbNGh1qCF71Ta0pKRNwmw',
      'Voucher: ac39e1c8-c598-473a-9da8-143de7c3a0e0',
    )
    const result = detectOtaEmail({
      fromEmail: 'messages@fareharbor.com',
      subject: 'New booking for Shared Cruise',
      bodyText: bodyWithUuidVoucher,
    })
    expect(result?.kind).toBe('needs_import')
    expect(result?.platform).toBe('boatlocal')
    expect(result?.stripePaymentIntentId).toBeNull()
  })

  it('recognizes a real "New Booking ... Created by: Viator-API (TripAdvisor Experiences/Viator - EUR - API)" notification as kind=needs_import, platform=tripadvisor', () => {
    const result = detectOtaEmail({
      fromEmail: 'messages@fareharbor.com',
      subject: 'New booking for Shared Cruise',
      bodyText: FAREHARBOR_NEW_BOOKING_VIATOR_BODY,
    })
    expect(result).toEqual({
      platform: 'tripadvisor',
      kind: 'needs_import',
      bookingRef: '372067461',
      guestName: 'Jason Tully',
      guestEmail: 'S-1a4dd43dab0d45aeb673337992bba328+1436673491-3912gzwelojp6@expmessaging.tripadvisor.com',
      guestPhone: '+1 404-394-6447',
      endTime: '18:30',
      stripePaymentIntentId: null,
      parsed: {
        date: '17 August 2026',
        time: '17:00',
        dateISO: '2026-08-17',
        guests: 2,
        experienceName: 'Shared Cruise',
        estimatedPriceCents: 7500,
        estimatedCommissionCents: 1500,
      },
    })
  })

  it('returns null for a fareharbor.com sender whose affiliate is not one we recognize yet', () => {
    const result = detectOtaEmail({
      fromEmail: 'messages@fareharbor.com',
      subject: 'New booking',
      bodyText: FAREHARBOR_NEW_BOOKING_GETYOURGUIDE_BODY.replace(/GetYourGuide - EUR - API/g, 'Some Other Reseller - API'),
    })
    expect(result).toBeNull()
  })

  it('returns null for a fareharbor.com sender that is not a "New Booking" notification at all', () => {
    const result = detectOtaEmail({
      fromEmail: 'messages@fareharbor.com',
      subject: 'Your weekly summary',
      bodyText: 'Here is your weekly booking summary.',
    })
    expect(result).toBeNull()
  })
})

describe('detectOtaEmail — non-OTA senders', () => {
  it('returns null for an unrelated sender entirely', () => {
    const result = detectOtaEmail({
      fromEmail: 'susanne@example.com',
      subject: 'Question about our booking',
      bodyText: 'Hi, can we bring our dog?',
    })
    expect(result).toBeNull()
  })
})
