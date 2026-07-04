# VAT Invoice PDF

## What was built

Every website booking confirmation email now carries an attached **VAT invoice
PDF** generated server-side, with a proper Dutch BTW breakdown and the legal
entity's registration details. The checkout screen and the confirmation email
both tell the customer the invoice is included, so business customers (who
routinely need an invoice to expense the trip) get one automatically instead of
emailing to ask.

**Legal entity on the invoice:**

```
Rederij Zoomers & Schenk
Herenmarkt 93 A, 1013 EC Amsterdam, Netherlands
KVK: 97275611
Omzetbelastingnummer (VAT): NL867981374B01
```

**VAT breakdown rules** (prices are VAT-inclusive; the invoice extracts VAT):

| Line | Rate | Notes |
|------|------|-------|
| Cruise (base) | 9% | NL tourism/transport rate |
| Each extra | 21% | one line per extra (drinks etc.) |
| Amsterdam city tax | 0% | €2.60 / guest, municipal levy — no VAT |
| Discount (promo) | 9% | negative line offsetting the cruise fare |

The PDF shows per-line net / VAT / total, a VAT-summary-by-rate block, the
grand total, and a "payment received" note carrying the Stripe PaymentIntent id
as the transaction reference.

**The invoice TOTAL DUE always reconciles to what the customer was actually
charged** (`base + extras + city tax − discount`). The discount is rendered as a
negative line at the cruise VAT rate, so a promo booking's invoice can never show
a total higher than the payment. The pure money layer is `buildInvoiceTotals()`
(exported and unit-tested); `net + vat === incl` per line, by construction.

## Key files

| File | Change |
|------|--------|
| `src/lib/booking/generate-invoice-pdf.ts` | **New.** `generateInvoicePdf(input)` builds the (multi-page-capable) A4 PDF with `pdf-lib`; `buildInvoiceTotals(input)` is the pure, tested money layer; `makeInvoiceNumber(fhUuid, piId)` derives a stable `OC-XXXXXXXX` number; `sanitizeForPdf` keeps non-WinAnsi text from crashing the fonts. |
| `src/lib/booking/generate-invoice-pdf.test.ts` | **New.** Reconciliation, VAT rates, discount line, invoice-number stability, WinAnsi sanitisation, hostile-input (emoji/CJK/null), and multi-page overflow. |
| `src/lib/booking/constants.ts` | **New.** Shared `CITY_TAX_CENTS_PER_GUEST` / `CRUISE_VAT_RATE` / `EXTRAS_VAT_RATE` (de-duplicated from `book/route.ts` + `calculate-quote.ts`). |
| `src/lib/booking/allocate-invoice-number.ts` | **New.** `allocateInvoiceNumber(stripePaymentIntentId)` — calls the `allocate_invoice_number` Postgres RPC; returns null on error so the caller falls back gracefully. |
| `src/lib/booking/allocate-invoice-number.test.ts` | **New.** 10 tests: sequential allocation, ascending order, idempotency (resend), concurrent same-PI lock behaviour, error/null paths. |
| `supabase/migrations/084_invoice_numbers.sql` | **New.** `CREATE SEQUENCE invoice_seq`, `bookings.invoice_number` column, unique constraint, and the `allocate_invoice_number` PL/pgSQL function (SECURITY DEFINER, service_role only). |
| `src/lib/booking/send-confirmation-email.ts` | `ConfirmationEmailInput` extended with `stripePaymentIntentId`, `baseAmountCents`, `discountAmountCents`, `cityTaxCents`. Generates the PDF **before** the HTML so the "📄 invoice attached" note only renders when a PDF actually exists. On generation failure, posts a Slack alert (the email still sends, without the note). |
| `src/app/api/admin/booking-flow/book/route.ts` | Reads **server-trusted** `server_base_amount_cents` + `discount_amount_cents` from the PaymentIntent metadata for the invoice (not the client-posted body). |
| `src/app/api/webhooks/stripe/route.ts` | Passes `baseAmountCents` + `discountAmountCents` from PI metadata. |
| `src/lib/booking/recover-from-pi.ts` | Same, from PI metadata. |
| `src/components/checkout/CheckoutFlow.tsx` | "📄 A VAT invoice will be included in your confirmation email" note under the pay button. |
| `package.json` | Added `pdf-lib` dependency. |

## Architecture decisions

**Why `pdf-lib`?** Pure-JS, no native binaries, no headless browser — it runs
fine in the Vercel serverless/Node runtime that already sends the email. A
Puppeteer/Playwright HTML-to-PDF approach would balloon the bundle and cold-start
for a one-page document. `@react-pdf/renderer` was the alternative; `pdf-lib`
won on zero runtime weight and direct drawing control.

**Why generate inside `sendConfirmationEmail` instead of a separate route?** The
invoice rides on the exact same data the confirmation email already has, and it
should attach to that one email. Generating it inline keeps a single source of
truth and one failure surface. PDF generation is wrapped in try/catch: **if it
fails, the email still sends** (without the attachment) — the invoice must never
block a booking confirmation. Crucially, the generation runs **before** the HTML
is built, so the "invoice attached" note is conditioned on the PDF actually
existing — the email never *claims* an attachment it doesn't carry. A generation
failure also fires a Slack alert so ops can issue the invoice manually.

**Why server-trusted amounts on the `/book` path?** The website `/book` route is
unauthenticated and receives `baseAmountCents`/`discountAmountCents` in the
request body. Rendering those onto a legal VAT document would let a tampered
request mint an invoice with an arbitrary amount. `/book` already retrieves the
PaymentIntent (for session attribution); it now also reads
`server_base_amount_cents` + `discount_amount_cents` from the PI metadata and
uses **those** for the invoice — the same trusted source the webhook uses.

**Why gate on `baseAmountCents`?** Internal/comp bookings (partner_invoice,
withlocals, etc.) pass `null`, so no consumer-facing VAT invoice is attached to
them — those settle through other channels. Only real website/recovery bookings
with a base amount get the PDF. (And because the note is now conditional, the
gated-out cases no longer claim a non-existent attachment.)

**Why does VAT *extraction* (not addition) happen in the PDF?** All stored prices
are VAT-inclusive (that's what the customer paid). The invoice shows the embedded
VAT via the **shared** `extractVat` from `@/lib/extras/calculate` (not a private
copy), so the invoice can never drift from the booking/conversion VAT math.

**WinAnsi safety.** `pdf-lib`'s standard fonts are WinAnsi-encoded and *throw* on
emoji/CJK/Cyrillic — which would silently drop the invoice for an international
customer. `sanitizeForPdf` maps smart punctuation to ASCII and strips anything
outside Latin-1 before it reaches `drawText`, so generation never crashes.

**Overflow.** Long bookings (many extras) paginate: the line-item table breaks to
a fresh A4 page when it would hit the footer band, and the footer is drawn on
every page. No more content overdrawing the totals.

**Invoice numbering.** Each invoice carries a gapless sequential number in the
format `OC-{year}-{5-digit-counter}` (e.g. `OC-2026-00042`), allocated by a
Postgres SEQUENCE + DB function (`allocate_invoice_number`). The number is
persisted on `bookings.invoice_number` and reused on resend — a second send for
the same booking returns the same number without consuming a new sequence value.
`makeInvoiceNumber` is kept as a non-sequential fallback for the rare case where
the DB is unreachable or the booking row doesn't exist yet.

## How it works

1. A booking completes via any website path (`/book`, webhook, or `/recover`).
2. That path calls `sendConfirmationEmail(...)` with `baseAmountCents` and
   `stripePaymentIntentId` alongside the usual cruise/contact fields.
3. `sendConfirmationEmail` calls `generateInvoicePdf`, which lays out the company
   header, bill-to, booking line, the VAT line-items table (cruise 9% · extras
   21% · city tax 0%), VAT summary, totals, and the payment reference.
4. The PDF bytes are attached to the Resend email as
   `invoice-off-course-<fhUuid>.pdf`; the email body notes the attachment.

## How to extend

- **New line-item type / VAT rate:** add it to `buildInvoiceTotals()` with its
  inclusive amount and rate; the VAT-summary block groups by rate automatically,
  and the totals stay reconciled. Add a test case to `generate-invoice-pdf.test.ts`.
- **Company-detail change** (address, KVK, VAT no.): edit the `COMPANY` constant
  in `generate-invoice-pdf.ts`. (The confirmation email footer carries the
  address separately in `send-confirmation-email.ts` — update both.)
- **Reissue an invoice for an existing booking:** call `generateInvoicePdf` with
  the booking's stored fields; numbering is deterministic from the FH UUID, so a
  reissue produces the same invoice number.
- **Localised invoices:** the generator is currency/locale-light (EUR, en-GB
  dates); thread a locale through `InvoiceInput` if NL-language invoices are
  needed.

## Dependencies

`pdf-lib` (PDF rendering), Resend (`attachments` field on `emails.send`), and the
booking pipeline that already computes `baseAmountCents`, `extrasSelected`, guest
count, and the FH/Stripe references. Company registration details:
Rederij Zoomers & Schenk, KVK 97275611, VAT NL867981374B01.
