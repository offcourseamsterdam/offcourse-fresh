# "Invoice later" — book now, bill with a Stripe Invoice

## What was built

**Invoice later** is the single admin booking source for anything paid by invoice. Staff books the cruise in the admin wizard and a real Stripe Invoice (iDEAL, card, or bank transfer to a Virtual IBAN, due 14 days after the tour) is emailed straight away to the business entered in step 3.

It replaces two older sources that meant the same thing:

- `stripe_invoice` ("Stripe Invoice (Factuur)") — sent a Stripe invoice at booking time. Removed; it was never used in production.
- The old `invoice_later` — only recorded "a partner owes us", and a Stripe invoice had to be sent afterwards by hand.

A **partner is optional**. Without one, the full amount is invoiced. With one (e.g. Amsterdam Boats B.V.), their commission (excl. 9% BTW) is suggested, is editable, and appears on the invoice as a "Partnerkorting" line.

Sending the invoice afterwards ("Factuur sturen via Stripe" on the booking row) still exists, but **only** for `invoice_later` bookings. It's the retry path when sending at booking time fails. Complimentary, platform (GYG, Withlocals, …) and website bookings can't get a Stripe invoice.

Our own VAT-invoice PDF on the confirmation email is a different thing. It's only attached to `website` bookings the guest actually paid through our checkout — never to complimentary or any other source.

## Key files

- [`src/lib/stripe/issue-booking-invoice.ts`](../../src/lib/stripe/issue-booking-invoice.ts) — `issueStripeInvoiceForBooking(bookingRowId, billing, options)`: the one path that creates, sends and links a Stripe Invoice for a booking row. Guards: row exists, not cancelled, source is `invoice_later`, not paid, no invoice linked yet.
- [`src/app/api/admin/booking-flow/book/route.ts`](../../src/app/api/admin/booking-flow/book/route.ts) — validates business details before booking FareHarbor, resolves the optional partner commission (`resolveInvoiceLaterContext`), saves the row, then calls `issueStripeInvoiceForBooking`. Returns `invoice` and `invoiceError`.
- [`src/app/api/admin/bookings/[id]/send-invoice/route.ts`](../../src/app/api/admin/bookings/[id]/send-invoice/route.ts) — thin admin wrapper around the same function (retroactive send / retry).
- [`src/lib/booking/invoice-eligibility.ts`](../../src/lib/booking/invoice-eligibility.ts) — `shouldAttachVatInvoicePdf()`: the single rule for attaching our PDF to a confirmation email.
- [`src/lib/booking/send-confirmation-email.ts`](../../src/lib/booking/send-confirmation-email.ts) — `bookingSource` is now a required input, so every caller must say what kind of booking it is.
- [`src/app/api/webhooks/stripe/route.ts`](../../src/app/api/webhooks/stripe/route.ts) — `payment_intent.succeeded` ignores PIs without booking metadata (`avail_pk`). A paid invoice's PI has none; `invoice.paid` reconciles it.
- [`src/app/[locale]/admin/fareharbor/page.tsx`](../../src/app/[locale]/admin/fareharbor/page.tsx) + [`GuestInfoStep.tsx`](../../src/components/admin/fareharbor/GuestInfoStep.tsx) — business details in step 3; optional partner, commission, and an invoice-total preview in step 5; a warning if the booking succeeded but the invoice didn't send.
- Finance: [`vat-stripe-summary`](../../src/app/api/admin/finance/vat-stripe-summary/route.ts) and [`btw-dashboard-calculator.ts`](../../src/lib/finance/btw-dashboard-calculator.ts) count paid invoices by `stripe_invoice_id`, not by booking source.

## Architecture decisions

**Row first, invoice second.** The booking row is saved before the Stripe invoice is created, and the invoice is issued through the same function the retry button uses. If Stripe fails, the FareHarbor booking and row stay, ops gets a Slack DM, and the admin retries from the row. The old `stripe_invoice` flow cancelled the FareHarbor booking instead, which lost the boat slot over a Stripe hiccup.

**One money model for the partner deduction.** `commission_amount_cents` for these bookings is the partner's cut **excl. 9% BTW**, computed over the cruise price only (drinks and city tax pass through at 100%). The invoice deducts `round(commission × 1.09)`. The wizard preview, the booking route and the invoice use that same formula. (The old "amount to invoice" field stored a gross difference in the same column, which disagreed with the partner-rate path.)

**Why the PDF rule lives inside the email function.** A guard at one caller already existed and still let a PDF through — from an older deploy, and the ai-ops branch has another caller (booking corrections) with no guard at all. Making `bookingSource` required and deciding inside `sendConfirmationEmail` covers every present and future caller.

**payment_status lifecycle:** `partner_invoice_pending` (row saved, invoice not sent yet) → `stripe_invoice_sent` → `paid` (via `invoice.paid`). No new status values were introduced.

## How it works

```
Admin wizard (source = invoice_later)
  step 3: business details (search / KVK / VIES)
  step 5: optional partner → GET /api/admin/booking-flow/invoice-suggestion?…&netBase=true
          → editable commission excl. BTW → invoice-total preview
  → POST /api/admin/booking-flow/book
      → requireAdmin → billing details complete?        (400 before touching FareHarbor)
      → resolveInvoiceLaterContext → FareHarbor validate + create
      → saveToSupabase (partner_invoice_pending, company fields, stripe_amount 0)
      → issueStripeInvoiceForBooking(row id)
          → Stripe customer → invoice lines (cruise 9%, extras 21%, city tax 0%, −Partnerkorting)
          → finalize + email → row: stripe_invoice_id, stripe_invoice_sent, amount due, OC-number
      → confirmation email (no PDF) + Slack
Later: invoice.paid webhook → payment_status 'paid', real PI + Stripe fee
```

## How to extend

Anything that needs to bill a booking by Stripe Invoice should call `issueStripeInvoiceForBooking`, not the lower-level `createAndSendStripeInvoice`. If another source ever needs Stripe invoices, change `STRIPE_INVOICE_BOOKING_SOURCE` deliberately and update the "Factuur sturen via Stripe" button gating in `BookingDetailRow.tsx` to match.

## Dependencies

- `GET /api/admin/partners` and `GET /api/admin/booking-flow/invoice-suggestion` (campaigns / partner `commission_rate`).
- Stripe Invoicing (`src/lib/stripe/invoicing.ts`), `allocate_invoice_number` RPC, `business_profiles`.
- Feeds partner settlement reports (`directionFor()` treats `invoice_later` as "partner owes us") and the BTW dashboards.
