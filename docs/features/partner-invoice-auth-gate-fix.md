# Partner-invoice auth gate fix (Webikeamsterdam checkout regression)

## What was built

Fixed a regression where the public, unauthenticated Webikeamsterdam QR-checkout (`payment_mode: 'partner_invoice'` listings) would have been rejected with `401 Unauthorized` the moment such a listing went live — discovered while scoping an unrelated admin feature request, not from a live incident report.

## Background

- [`partner-invoiced-listings.md`](partner-invoiced-listings.md) added `bookingSource: 'partner_invoice'` as a **public, unauthenticated** checkout path: a customer at a partner desk scans a QR code, types a rotating partner code, and books with no Stripe payment.
- A later security fix ([`023d68f`](../../src/app/api/admin/booking-flow/book/route.ts)) closed a real hole — any caller could POST an internal `bookingSource` (`partner_invoice`, `stripe_recovery`, `withlocals`, etc.) and create a real FareHarbor booking without paying — by requiring `requireAdmin()` for every non-`website` source.
- That fix didn't account for `partner_invoice` being *also* a legitimate public flow. It unconditionally required an admin session, which a QR-scanning customer never has.

## Why this wasn't caught yet

`SELECT count(*) FROM cruise_listings WHERE payment_mode = 'partner_invoice'` currently returns **0** in production, even though `partner_codes` has 1 active code and `partners` has 7 rows — the integration was built and partially configured but no listing has been flipped into partner-invoice mode yet. So no real customer has hit this 401 yet; it would have fired on the first checkout attempt once a listing went live.

## The fix

`src/app/api/admin/booking-flow/book/route.ts` — the admin-auth gate now has one exception:

```
isAuthorizedByPartnerCode = isPartnerInvoice && (promoCodeId or partnerCode present)
if (isInternal && !isAuthorizedByPartnerCode) → requireAdmin()
```

- `partner_invoice` **with** a code → skips `requireAdmin()`. The code itself is the authorization — `resolvePartnerInvoiceContext()` (unchanged) validates it and rejects anything invalid or expired before any booking is created, exactly as it did before the security fix.
- `partner_invoice` **without** a code (e.g. an admin creating one directly, or an attacker) still requires a real admin session — there's no self-proving credential to lean on otherwise.
- Every other internal source (`stripe_recovery`, `withlocals`, `clickandboat`, `getyourguide`, `tripadvisor`, `complimentary`) is unaffected — still always admin-gated, closing the original hole.

The static auth-contract test (`admin-route-contract.test.ts`) only checks for the *presence* of `requireAdmin(` in a handler's source, not its runtime conditions, so it still correctly classifies this route as guarded — no update needed there.

## Verified

Type-check and full suite pass (778/778 — 4 new tests added covering: code present → no admin check; legacy `partnerCode` present → no admin check; no code → admin required; other internal sources → admin required regardless of any code fields). No live click-through was possible — there's no partner-invoice listing configured in production to test against, and creating one just to exercise this would be a bigger, unrelated change.
