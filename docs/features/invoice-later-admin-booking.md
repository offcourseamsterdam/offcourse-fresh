# "Invoice later" admin booking (pick a partner directly)

## What was built

A new admin-only booking source, **Invoice later**, that lets staff create a booking billed to an existing partner without any payment now. It grew out of discovering that "Partner invoice" — the only partner-billing option previously visible in the admin wizard — is actually the *public* Webikeamsterdam QR-checkout flow (a customer types a rotating code; see [partner-invoice-auth-gate-fix.md](partner-invoice-auth-gate-fix.md)) and was never meant for admin use. "Partner invoice" is now hidden from the admin wizard's source picker; "Invoice later" replaces it for the admin use case.

Flow: pick "Invoice later" as the booking source → go through the normal listing/slot/guest steps → at the confirm step, pick an existing partner from a dropdown and confirm (or edit) a suggested amount to invoice them. No Stripe charge happens. The booking is created in FareHarbor immediately; the invoice itself is handled later (e.g. via Snelstart), same as the existing partner-invoice accounting model.

## Key files

- [`src/lib/constants.ts`](../../src/lib/constants.ts) — `BOOKING_SOURCES` gained `invoice_later` and an `adminSelectable` flag; `partner_invoice` is now `adminSelectable: false`.
- [`src/lib/booking/invoice-suggestion.ts`](../../src/lib/booking/invoice-suggestion.ts) — pure helpers: `computeInvoiceSuggestion(baseAmountCents, campaign)` (base minus commission when an active % campaign exists, else full amount) and `commissionFromInvoiceAmount(base, invoiceAmount)` (the inverse, for storing `commission_amount_cents`). Unit tested.
- [`src/app/api/admin/booking-flow/invoice-suggestion/route.ts`](../../src/app/api/admin/booking-flow/invoice-suggestion/route.ts) — `GET ?partnerId&listingId&baseAmountCents`, looks up an active campaign for that partner+listing and returns the suggestion. Admin-only.
- [`src/app/api/admin/booking-flow/book/route.ts`](../../src/app/api/admin/booking-flow/book/route.ts) — `resolveInvoiceLaterContext()` validates the partner exists and derives `commission_amount_cents` from the admin's confirmed invoice amount; wired into `resolveAttribution()` as a 4th, highest-priority attribution source; `saveToSupabase` sets `payment_status: 'partner_invoice_pending'` for this source (same as the QR flow — same real-world state).
- [`src/app/[locale]/admin/fareharbor/page.tsx`](../../src/app/[locale]/admin/fareharbor/page.tsx) — partner dropdown + editable invoice-amount field in the step-5 confirm panel; fetches the partner list once, fetches the suggestion once a partner + listing are both known, never overwrites an amount the admin already typed.
- [`src/app/api/admin/finance/partners-summary/route.ts`](../../src/app/api/admin/finance/partners-summary/route.ts), [`src/app/api/admin/partners/[id]/settlement-summary/route.ts`](../../src/app/api/admin/partners/[id]/settlement-summary/route.ts), [`src/app/partners/[token]/page.tsx`](../../src/app/partners/[token]/page.tsx) — the `directionFor()` fallback (used when a booking has no linked campaign) now also treats `invoice_later` as the "partner owes us" direction, same as `partner_invoice`. Without this fix, invoice_later bookings without a campaign would have been miscategorized as "we owe partner" in quarterly settlements — including on the partner's own portal page.

## Architecture decisions

**Reuses the existing partner-invoice accounting model rather than inventing a new one.** `commission_amount_cents` already means "the partner's cut" everywhere in this codebase (settlement summaries, the partner portal, finance dashboards). Rather than add a parallel `invoice_amount_cents` concept, the admin-facing "amount to invoice" is converted to/from that existing column: `commission_amount_cents = base_amount_cents - invoiceAmountCents`. Every existing report that already understands `commission_amount_cents` works correctly for `invoice_later` bookings with zero changes beyond the direction fallback above.

**Suggestion is fetched, not enforced.** If an active percentage campaign exists for the chosen partner + listing, the suggested amount reflects it (same commission math as the QR flow). If not, the suggestion defaults to the full base amount. Either way the admin can freely override the number before confirming — there's no server-side requirement that a campaign exist (unlike the public `partner_invoice` flow, which does require one).

**No code required, unlike `partner_invoice`.** The admin picks the partner directly from a dropdown populated from `GET /api/admin/partners`. This is intentionally a different trust model from the QR flow: an authenticated admin session is the authorization here (this source is never exempted from the `requireAdmin()` gate), where the QR flow instead trusts a valid rotating code from an unauthenticated customer.

## How it works

```
Admin wizard, step 5 (source = invoice_later)
  → GET /api/admin/partners                          (populate dropdown, once)
  → partner selected + listing/rate known
  → GET /api/admin/booking-flow/invoice-suggestion    (pre-fill suggested amount)
  → admin confirms or edits the amount
  → POST /api/admin/booking-flow/book
      → resolveInvoiceLaterContext: partner exists? → commission = base - invoiceAmount
      → resolveAttribution: invoiceLaterContext wins (highest priority)
      → saveToSupabase: partner_id, commission_amount_cents, payment_status='partner_invoice_pending'
```

## How to extend

If a future admin flow needs a different billing model (e.g. a fixed platform fee instead of a base-minus-commission split), extend `computeInvoiceSuggestion`/`commissionFromInvoiceAmount` rather than introducing a new column — every downstream report already reads `commission_amount_cents`.

## Dependencies

- Depends on `GET /api/admin/partners` (pre-existing) for the dropdown list.
- Depends on the `campaigns` table's `percentage_value`/`investment_type` (pre-existing) for the suggestion lookup — same source as the QR flow's commission math.
- Feeds the same quarterly settlement reports as `partner_invoice` ([`partner-invoiced-listings.md`](partner-invoiced-listings.md)).
