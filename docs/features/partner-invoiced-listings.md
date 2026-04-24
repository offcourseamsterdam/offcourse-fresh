# Partner-Invoiced Listings (Webikeamsterdam pattern)

## What was built

A new checkout path for listings that are sold **at a physical partner desk** (e.g. Webikeamsterdam) rather than online. Customers scan a QR code printed on their receipt, land on a dedicated cruise listing, type a rotating partner code, and confirm — **no online payment**. Off Course invoices the partner monthly for the share it owes us (e.g. 85% of the ticket total; partner keeps 15% as their cut).

The model uses the existing virtual-listing + campaign architecture, so only two tiny schema additions were needed.

## How it works

```
Customer at partner desk
  → Partner sells ticket for €100 (cash/card, partner keeps it)
  → Partner prints receipt with QR + short partner code (e.g. WBKA-2X9F)
  → Customer scans QR → lands on unguessable listing URL
  → Picks date + time + guests
  → Checkout: no Stripe, just contact details + partner code
  → Booking confirmed in FareHarbor
  → Supabase booking row: payment_status='partner_invoice_pending',
    partner_id set, commission_amount_cents set (partner's 15% cut)
  → Slack ping: "🤝 New partner-invoice booking · €100 · €85 to invoice · €15 partner cut"
  → End of month: admin pulls rollup per partner and invoices them
    for SUM(base_amount_cents - commission_amount_cents) / 100
```

Partner codes expire every 3 months. A weekly cron posts a Slack reminder
when any active code is within 14 days of expiring.

## Key files

### Schema
- `supabase/migrations/032_partner_invoiced_listings.sql` — adds
  `payment_mode` + `required_partner_id` to `cruise_listings`; creates
  `partner_codes` table.
- `src/lib/supabase/types.ts` — patched in-file with the new columns +
  table (regenerate in CI on next full types refresh).

### Server logic
- `src/lib/partner-codes/generate.ts` — `generatePartnerCode()` (8-char
  XXXX-XXXX, no lookalike chars), `normalizePartnerCode()` (idempotent
  uppercase + dash), `threeMonthsFromNow()`.
- `src/lib/partner-codes/validate.ts` — pure, DB-free
  `validatePartnerCode(input, expectedPartnerId, row, now)` with explicit
  rejection reasons + user-facing `reasonMessage()`.
- `src/lib/partner-codes/validate.test.ts` — covers valid / empty /
  not-found / wrong-partner / revoked / expired / boundary at exact
  expiry, plus generator + normalizer properties.
- `src/lib/slack/send-notification.ts` — `postSlackText(text)` — a
  shared, never-throwing helper used by the cron. The existing
  per-booking Slack message in the booking endpoint still lives there;
  extracting the whole template is follow-up work.

### API routes
- `src/app/api/admin/partners/[id]/codes/route.ts` — `GET` lists codes,
  `POST` generates a fresh code with 3-month expiry (retries on the
  vanishingly unlikely collision). Previous codes are **not**
  invalidated; they run out their own clock so physical receipts already
  in circulation keep working.
- `src/app/api/admin/partners/[id]/codes/[codeId]/route.ts` — `PATCH`
  revokes a single code (`is_active=false`, `revoked_at=now`). No hard
  deletes — we need the audit trail for invoiced bookings.
- `src/app/api/admin/booking-flow/book/route.ts` — added the
  `partner_invoice` branch. Before FareHarbor validation it:
  1. confirms `listing.payment_mode === 'partner_invoice'`,
  2. looks up the code and runs it through `validatePartnerCode`,
  3. finds the active `campaigns` row joining this listing + partner
     and pulls its `percentage_value` as the commission %,
  4. writes the booking with `stripe_payment_intent_id=null`,
     `payment_status='partner_invoice_pending'`, and the computed
     `commission_amount_cents`.
  The Slack message grows an extra line: sale / to-invoice / partner cut.
- `src/app/api/cron/partner-code-expiry/route.ts` — runs Mondays 09:00
  UTC (via `vercel.json`), finds codes expiring in the next 14 days,
  pings Slack with the partner name, the code, and a deep link to the
  admin partner page so whoever's on-call can roll a new one.

### UI
- `src/app/[locale]/book/[slug]/checkout/page.tsx` — server page now
  also selects `payment_mode` + `required_partner_id` and, for
  partner-invoice listings, joins `partners(name)` to pass the
  partner name to the client. Its metadata always ships `noindex`.
- `src/components/checkout/CheckoutFlow.tsx` — when
  `paymentMode === 'partner_invoice'` it skips
  `/api/booking-flow/create-intent`, hides the Stripe `Elements`
  mount entirely, and on submit POSTs directly to
  `/api/booking-flow/book` with `bookingSource: 'partner_invoice'` and
  the typed code. The progress bar collapses from 3 steps to 2.
- `src/components/checkout/GuestInfoForm.tsx` — optional partner-code
  field gated by `requirePartnerCode`. Uses a big monospace uppercase
  input with autocomplete/spellcheck disabled so codes like `WBKA-2X9F`
  don't get mangled by mobile keyboards.
- `src/app/[locale]/book/[slug]/confirmation/page.tsx` — now accepts an
  `fh` (FareHarbor UUID) query param as an alternative to
  `payment_intent`, and shows a green "No payment needed here" panel
  when the booking's `payment_status === 'partner_invoice_pending'`.
- `src/app/[locale]/cruises/[slug]/page.tsx` — `generateMetadata`
  ships `robots: { index: false, follow: false }` when the listing is
  partner-invoice. The URL is still public (and must be for the QR to
  work), but search engines won't pick it up.
- `src/app/[locale]/admin/partners/[id]/page.tsx` — new detail page
  with a partner-codes section: one-click copy, status pills
  (active / expiring soon / expired / revoked), a dropdown with the
  history of old codes, and a prominent generate button.
- `src/app/[locale]/admin/partners/page.tsx` — partner name is now a
  link to the detail page.

### Config
- `src/lib/constants.ts` — `partner_invoice` added to `BOOKING_SOURCES`.
- `vercel.json` — new cron entry for `/api/cron/partner-code-expiry`.

## Architecture decisions

**Why `payment_mode` on the listing, not a dedicated "partner listing"
table?** The virtual-listing architecture already separates listings
from FareHarbor inventory — a partner listing is just another storefront
with different config. Adding a new table would fragment the "is this
available?" query across two places.

**Why keep the code validation pure and move DB lookup to the caller?**
It lets us unit-test every rejection path (wrong partner, expired,
revoked, empty) without spinning up Supabase, and makes the booking
route's branch easy to read top-to-bottom.

**Why not invalidate old codes when a new one is generated?** Because
QR codes printed on physical receipts are already in circulation and
already handed to customers. Revoking the old code the moment a new one
is generated would break bookings mid-flight. Letting the old one run
out its natural 3-month window is the safer default; admins can still
manually revoke a specific code if they need to.

**Why require manual typing of the code at checkout (not URL
pre-filling)?** Because the whole point of "the URL shouldn't be shared
freely" is defeated if the code is baked into the URL — any screenshot
of the QR becomes a free booking. Manual entry forces the customer to
have the physical receipt in hand.

**Why reuse `campaigns.percentage_value` for the commission instead of
a new column on the listing?** The campaigns table already supports
per-listing, per-partner percentage commissions for regular bookings,
and the admin UI for editing campaigns already exists. Tying
partner-invoice bookings to a campaign means: one place to change the
rate, one report rolling up "what does this partner owe us" regardless
of flow.

**Why `payment_status='partner_invoice_pending'` (a new value) instead
of reusing `'comp'`?** A comp booking is a freebie we gave away; a
partner-invoice booking is money we're owed. The monthly rollup query
needs to be unambiguous; conflating them would silently under-invoice.

## How to extend

### Add a new partner
1. `/admin/partners` → "New partner" → fill in name/email.
2. Open the partner detail page → "Generate new code".
3. Create a listing in `/admin/cruises` with `payment_mode =
   'partner_invoice'` and `required_partner_id` set. Give it an
   unguessable slug (e.g. `webikeamsterdam-x7f9q2`). **The UI for these
   two fields on the listing form is a known follow-up — for v1 they
   can be set via the Supabase table editor or a small patch to the
   admin cruise form.**
4. Create a campaign in `/admin/campaigns` linking that listing +
   partner, `investment_type: 'percentage'`, `percentage_value`: the
   partner's cut (e.g. 15 = they keep 15%, we invoice 85%).
5. Print QR stickers pointing at `/en/cruises/{slug}` and give the
   partner desk the current code to write on each receipt.

### Change the code rotation period
Edit `threeMonthsFromNow` in `src/lib/partner-codes/generate.ts`. Update
the 14-day warning window in `src/app/api/cron/partner-code-expiry/route.ts`
to match.

### Invoice a partner at month end
Run this SQL (wire it into the admin later):
```sql
SELECT
  partner_id,
  SUM(base_amount_cents - COALESCE(commission_amount_cents, 0)) / 100.0 AS invoice_total_eur,
  COUNT(*) AS n_bookings
FROM bookings
WHERE payment_status = 'partner_invoice_pending'
  AND partner_id IS NOT NULL
  AND booking_date >= date_trunc('month', now() - interval '1 month')
  AND booking_date <  date_trunc('month', now())
GROUP BY partner_id;
```
Once the invoice is sent, flip the bookings to `'partner_invoice_sent'`
(future admin action) and when paid to `'partner_invoice_paid'`. A full
state machine UI is a follow-up.

## Dependencies

- Depends on: the existing `partners`, `campaigns`, `cruise_listings`,
  `bookings` tables; the existing booking endpoint at
  `src/app/api/admin/booking-flow/book/route.ts`; Vercel Cron +
  `CRON_SECRET`; `SLACK_WEBHOOK_URL`.
- Used by: nothing yet — it's a net-new surface. The monthly-summary
  and quarterly-invoice crons will eventually want to know about these
  bookings (recommend filtering by `payment_status` in their queries
  to avoid double-counting).

## Running the migration

Per `CLAUDE.md`, from a shell with `SUPABASE_MANAGEMENT_TOKEN` set:
```bash
SQL=$(cat supabase/migrations/032_partner_invoiced_listings.sql)
curl -s -X POST "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/database/query" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"query\": $(echo \"$SQL\" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')}"

# Regenerate types afterwards
curl -s "https://api.supabase.com/v1/projects/fkylzllxvepmrtqxisrn/types/typescript" \
  -H "Authorization: Bearer $SUPABASE_MANAGEMENT_TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['types'])" \
  > src/lib/supabase/types.ts
```

## Tests

- `src/lib/partner-codes/validate.test.ts` — 17 unit tests covering
  validation, normalization, generation, and user-facing messages.

Run with `npm test`.

## Follow-ups (not in v1)

1. Expose `payment_mode` and `required_partner_id` in the admin cruise
   form (currently set via Supabase table editor for v1).
2. Admin UI for the invoice state machine
   (`pending → sent → paid`) plus per-partner invoice pages and PDF
   generation via Resend.
3. Optional per-code usage cap (hard limit on bookings per code) for
   extra abuse protection in case a partner's receipts leak.
4. Internationalise the partner-code field labels and error messages
   (they're English-only in v1, matching the rest of checkout UX for
   partner flows which are only used at Amsterdam desks).
