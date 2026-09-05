# Finance Inbox v2 — Expense Records: Revolut ↔ E-mail ↔ SnelStart

**Date:** 2026-09-05
**Status:** BUILT 2026-09-05 — Phases 0–5 implemented; see docs/features/finance-inbox-expense-records.md
**Owner:** Beer
**Source PRD:** "Finance Inbox — Revolut, E-mail Matching & SnelStart" (Beer, 2026-09-05, incl. the
BTW-position addendum and the architecture diagram). Builds on
`docs/plans/2026-09-04-financial-management-module.md` (Phases 0–5 built, live).

---

## 0. The one-paragraph version

Every euro that leaves Revolut becomes one **Expense Record**. Two streams feed it in parallel —
Revolut (the transaction, plus any receipt/tax data Beer attached in the Revolut app) and the finance
mailbox (order confirmations, invoice PDFs, "your invoice is available" mails). A matching engine
decides which pieces belong to the same purchase, VAT is worked out from the best available source
(and *flagged*, never silently overwritten, when sources disagree), and once a record is complete the
original document is e-mailed to SnelStart's Scan & Herken mailbox. On top sits a live view of the
BTW position: what was spent, what part of that is reclaimable purchase VAT, what sales VAT is owed,
and the estimated net per quarter.

---

## 1. What exists, and what we do with it

| Thing (already live) | Verdict |
|---|---|
| Revolut sync every 15 min → `bank_transactions`, webhook, balance snapshots (`src/lib/revolut/*`) | **Extend.** Add `/expenses` + receipt download to the client and one extra step to the sync. Never a second sync loop. |
| Finance mailbox alias (`GMAIL_FINANCE_ADDRESS`), `source_category='finance'`, PDF attachment ingestion → `finance_invoices` + Gemini extraction (`src/lib/finance/inbox/*`, `invoices/*`) | **Extend.** Today a finance mail *without* a PDF is a no-op. Now every finance mail is read (Claude, text) and becomes a document on an expense record. The skipper-invoice → approve → Revolut-draft flow stays exactly as is (see §2.3). |
| Classification (`cockpit/classify/*`): category, boat, goal, structural rules | **Keep.** An expense record links to the classified transaction; it does not replace the category. The structural rules already know which transactions are internal transfers/fees — those expenses are `ignored`, so "missing invoices" stays honest. |
| Kasboek BTW dashboard (`btw-dashboard-calculator.ts`) — *sales*-side VAT across ten channels | **Reuse as the "VAT payable" half** of the VAT position. The new records supply the "VAT reclaimable" half. No second sales-VAT calculation. |
| Skipper invoice matcher (`invoices/match.ts`, 8 checks against shifts) | **Keep, untouched.** It answers "should we pay this skipper". The new matcher answers "which payment does this document belong to" — different question, different module (`expenses/match.ts`). |
| `finance-attachments` bucket, signed-URL route `attachments/[source]/[id]` | Reuse; add an `expense_document` source (admin-only, like `invoice`). |
| Gmail send (`sendNewEmail`) | **Extend** with MIME attachments — it can't attach a file today, and SnelStart needs the original PDF/receipt. |

### 1.1 Revolut Business API facts that shape the design (verified 2026-09-05, developer.revolut.com)

| Fact | Consequence |
|---|---|
| `GET /api/1.0/expenses?from&to&count(≤500)&state&transaction_type` — sorted by `expense_date` desc; page by passing the last item's `expense_date` as `to`. Returns `{id, state, transaction_type, description, merchant, transaction_id?, expense_date, splits[{amount{amount,currency}, category, tax_rate{name, percentage}}], labels, receipt_ids[], spent_amount}`. | One extra step in the existing sync. `transaction_id` is how an expense joins its `bank_transactions` row. **Not every expense has one** — those become document-only records matched by amount/date/merchant. |
| VAT comes as a **rate** per split (`tax_rate.percentage`), not an amount. | `vat_cents = round(split_gross × pct / (100 + pct))`, summed over splits; stored with `vat_source='revolut'`. |
| `GET /api/1.0/expenses/{expense_id}/receipts/{receipt_id}/content` → `application/octet-stream`, "format depends on the receipt". | Binary request path in the client; file type sniffed from magic bytes (PDF/JPEG/PNG/HEIC), never from a header. |
| Expenses endpoints are **not available in Sandbox**. `READ` scope suffices. | Production-only; tests mock the client. The current connection is production with READ+WRITE — nothing to re-consent. |

---

## 2. Data model (migration `160_finance_expenses.sql`; RLS ON, zero policies)

```
finance_expenses                       -- ONE row per purchase / cash-out event
  id uuid, ref text UNIQUE             -- 'FIN-000001' from a sequence, the human handle
  status text                          -- see §5
  supplier_id uuid → finance_suppliers (null until resolved)
  supplier_name text                   -- as observed (merchant / invoice header), for display + matching
  -- payment side
  bank_transaction_id uuid → bank_transactions  UNIQUE (partial)
  cash_out_cents int                   -- what actually left the account (positive)
  paid_at timestamptz
  -- revolut expense/receipt side
  revolut_expense_id text UNIQUE (partial), revolut_expense_state text
  revolut_vat_rate_pct numeric, revolut_vat_cents int    -- derived from splits, source-labelled
  -- document side
  primary_document_id uuid → finance_documents  (the thing that goes to SnelStart)
  order_number text, invoice_number text, invoice_date date
  -- accounting
  gross_cents int, net_cents int, vat_cents int, vat_rate_pct numeric
  vat_source text CHECK IN ('invoice','receipt','revolut','ai','manual')
  vat_conflict jsonb                   -- {invoice_vat_cents, receipt_vat_cents, revolut_vat_cents} when they disagree
  -- matching
  match_confidence numeric(4,3), match_signals jsonb, matched_at timestamptz
  -- snelstart
  snelstart_sent_at timestamptz, snelstart_document_id uuid, snelstart_recipient text,
  snelstart_message_id text, booked_at timestamptz
  -- review
  needs_review_reason text, reviewed_at timestamptz, notes text
  created_at, updated_at

finance_documents                      -- every artefact, attached or still orphan
  id uuid
  expense_id uuid → finance_expenses (null = orphan, waiting for its payment/expense)
  kind text CHECK IN ('invoice_pdf','receipt_image','revolut_receipt','order_confirmation_email',
                      'invoice_notification_email','payment_confirmation_email','other_email','invoice_link')
  source text CHECK IN ('email','revolut','upload')
  source_message_id uuid → messages, revolut_expense_id text, revolut_receipt_id text
  file_path text, original_filename text, mime_type text
  sha256 text UNIQUE (partial)         -- duplicate detection on bytes
  extracted jsonb                      -- {supplier_name, order_number, invoice_number, invoice_date,
                                       --  gross_cents, net_cents, vat_cents, vat_rate_pct, currency,
                                       --  iban, payment_reference, link_url} + per-field confidence
  link_url text, link_fetch_status text CHECK IN ('not_attempted','fetched','blocked','failed')
  duplicate_of uuid → finance_documents
  created_at

bank_transactions  + expense_id uuid → finance_expenses   (the reverse pointer for fast joins)
finance_settings   + snelstart_auto_forward boolean DEFAULT true
```

`ref` uses a Postgres sequence (`finance_expense_ref_seq`) so two concurrent inserts never share a
number — same reason the invoice numbering uses a sequence.

### 2.1 Why documents are their own table

A purchase is one record but arrives as several things at different times: a card payment today, an
order confirmation tonight, the invoice PDF next week, maybe a receipt photo in Revolut. Each is
stored once, with its own hash, and *points at* the expense. Before its expense exists (an invoice
arriving before the transfer, PRD situation C) the document is an orphan the matcher keeps trying.

### 2.2 Which document goes to SnelStart

`primary_document_id`, chosen by preference: invoice PDF > fetched invoice link > receipt (Revolut or
e-mailed image) > order confirmation. An order confirmation alone is never enough for
`ready_for_snelstart` — it proves the order, not the cost breakdown.

### 2.3 How this relates to the existing `finance_invoices` (skipper/supplier payables)

Two different questions, two tables, one meeting point:

- `finance_invoices` = *things we still have to pay* (skipper hours, a marina invoice) → approve →
  Revolut payment draft. Unchanged.
- `finance_expenses` = *money that has left (or will leave) the account and must be booked*.

They meet when a payable's Revolut transfer completes: the sync sees the `completed` transaction,
creates its expense record, and links the already-stored invoice PDF as its primary document
(`kind='invoice_pdf'`, same `file_path`, no second upload). So a paid skipper invoice still ends up as
one Expense Record on its way to SnelStart, without duplicating the approve/pay flow.

Mail from a **staff** sender keeps going down the payable pipeline exactly as today. Everything else
at the finance alias (a supplier, a webshop, an unknown sender) goes down the new expense pipeline.

---

## 3. Ingestion

### 3.1 Revolut (extends `sync.ts`)

After the transaction upsert, in the same 15-minute run:

1. **Every new/changed `completed` outgoing transaction** (`amount_cents < 0`) gets an expense record
   (`bank_transaction_id`, `cash_out_cents`, `paid_at`, `merchant/supplier_name` from the leg), status
   `waiting_for_invoice` — unless `classifyStructural()` says it's an internal transfer or a
   fee/exchange, in which case `ignored` (a document will never exist; the KPI must not count it).
   Incoming money is not an expense. One-time backfill: the last 90 days of completed outgoing
   transactions (`scripts/finance/backfill-expenses.ts`, dry-run by default).
2. **Expenses**: `listExpenses` since `last_sync − 7d`. With `transaction_id` → find the record via
   `bank_transactions.revolut_id`, stamp `revolut_expense_id`, VAT rate/amount (`vat_source='revolut'`
   only if nothing better exists yet — an invoice always outranks it). Without → an orphan
   `finance_documents` row (`kind='revolut_receipt'` once the receipt is stored) that the matcher
   pairs by amount/date/merchant.
3. **Receipts**: for each `receipt_id` not yet stored → download → sniff type → cap 15 MB → store at
   `revolut/<expense_id>/<receipt_id>.<ext>` → sha256 → `finance_documents(kind='revolut_receipt')` →
   Gemini vision extraction (`expenses/extract-document.ts`, generic prompt) → VAT resolution (§4.2).

### 3.2 E-mail (extends `finance/inbox/ingest.ts`)

For a finance-alias message from a non-staff sender:

1. **Classify + extract the mail itself** with Claude (text): `{kind, supplier_name, order_number,
   invoice_number, amounts, dates, links[], is_paid_confirmation}`. Kind ∈ order_confirmation /
   invoice_notification / payment_confirmation / invoice_attached / other. Null for anything not
   clearly written — same "never invent" rule as `extract.ts`.
2. **Attachments**: PDFs → generic invoice extraction (Gemini, new prompt: no skipper fields, adds
   order_number / payment_reference / currency / net+gross+vat); images (jpg/png/heic) → receipt
   extraction. Server-generated storage keys, magic-byte check, sha256 — all already the convention.
3. **Links**: every URL in the body is recorded. A fetch is attempted only when it is plainly a
   public document: no cookies/auth, GET with a 10 s timeout and 15 MB cap, redirects followed at most
   3× and never into private/loopback address space (SSRF guard), and the response must *be* a PDF by
   magic bytes. Anything else → `link_fetch_status='blocked'`, surfaced on the card as "download
   handmatig" with an upload button. We never log into a supplier portal.
4. Everything becomes `finance_documents` rows → the matcher runs (§4).

### 3.3 Manual upload

The existing "Factuur uploaden" gains a target: attach to a specific expense (from its drawer) or
upload loose (orphan → matcher). Same `processInvoiceFile`-style pipeline.

---

## 4. Matching engine and VAT (pure modules, fixture-tested)

### 4.1 `expenses/match.ts` — `scoreMatch(document, expense) → {score, signals}`

Signals, each contributing to a 0..1 score; no single field decides:

| Signal | Weight | Notes |
|---|---|---|
| exact gross amount = cash_out | 0.35 | the anchor |
| amount within max(€1, 1%) | 0.20 | FX rounding, card fees |
| supplier/merchant name similarity (normalised tokens, e.g. "BOL.COM BV" ≈ "Bol.com") | 0.20 | |
| date proximity: doc date within [tx − 2d, tx + 14d] (order confirmations: [tx − 3d, tx + 1d]) | 0.15 | |
| order_number or invoice_number appears in tx reference/description | 0.15 | strong when present |
| IBAN equality (transfers) | 0.15 | |
| currency equality | required (mismatch → 0) | |

Thresholds: **≥ 0.90 auto-match**, **0.60–0.89 `partially_matched`** (one click to confirm),
**< 0.60 no match** (stays orphan / waiting). Runs in both directions: a new document searches open
expenses; a new transaction searches orphan documents. Ties → the closer date wins; a near-tie
(Δscore < 0.05) → `needs_review`, never a coin flip. The PRD's Bol.com example (€121 card payment,
order mail, invoice PDF with matching number) and the €24,20 ice-cream receipt are the fixtures.

### 4.2 `expenses/vat.ts` — `resolveVat(candidates) → {vat_cents, net_cents, rate, source, conflict}`

Candidates carry their source. Preference: `invoice` > `receipt` > `revolut` > `ai`. If two present
sources differ by more than €0,02 → the preferred one is used **and** `vat_conflict` is recorded and
the record goes to `needs_review` (PRD §8: "mag een verschil niet stilzwijgend overschrijven").
Reverse-charge / 0 % is a valid answer (vat 0, rate 0), not a missing one. `manual` (Beer typed it)
outranks everything and clears the conflict.

### 4.3 `expenses/status.ts` — `deriveStatus(expense, documents)`

```
ignored                 structural rule says no document will ever exist
waiting_for_invoice     payment ✓, no invoice/receipt document
waiting_for_payment     invoice/receipt ✓, no payment
partially_matched       both present but match score 0.60–0.89, or only an order confirmation
matched                 payment ✓ + document ✓, score ≥ 0.90
needs_review            VAT conflict, near-tie, duplicate suspicion, or Beer flagged it
ready_for_snelstart     matched + VAT resolved without conflict + primary document is invoice/receipt
sent_to_snelstart       forwarded (sent_at set)
booked                  Beer (or later: SnelStart feedback) confirmed booking
```

Pure and total: every combination of inputs maps to exactly one status; the tests enumerate them.

### 4.4 Duplicates

Before creating anything: same `sha256` → attach as `duplicate_of` the existing document, never a
second expense; same `(normalised supplier, invoice_number)` on another expense → `needs_review`
("mogelijk dubbel"); `revolut_expense_id` / `bank_transaction_id` unique at the DB level.

---

## 5. SnelStart forwarding

- `gmail/client.ts`: `sendNewEmail({..., attachments: [{filename, mimeType, content: Buffer}]})` —
  multipart/mixed MIME, base64 parts. Tested against the raw RFC 2822 output.
- `SNELSTART_INBOX_EMAIL` env (default `offcourse@boekhouding.nl`, in `.env.example`).
- Cron `finance-snelstart-forward` (hourly) + a manual "Verstuur naar SnelStart" action: for every
  `ready_for_snelstart` record with `snelstart_auto_forward` on, send the primary document from the
  finance mailbox, subject `FIN-000123 · <supplier> · €<gross> · <invoice_number>`, body listing
  gross/net/VAT and the Revolut date. Record `snelstart_sent_at / recipient / document_id /
  message_id`, status → `sent_to_snelstart`, `finance_events` row. **Never twice**: the send is
  conditional on `snelstart_sent_at IS NULL` (same written-once pattern as invoice decisions).
- `booked` is a manual click in v1. Reading SnelStart's confirmation mails back is a follow-up.

---

## 6. Dashboard & UI

- **`/admin/finance/expenses` ("Uitgaven")** in the FinanceSubnav: KPI header (Cash spent · Net
  expenses · VAT reclaimable · VAT payable · Estimated VAT position, per quarter/month selector;
  counts: unmatched transactions · missing invoices · needs review), then the list with status pills
  and filters, then a detail drawer per record: payment · documents (Bekijk via the attachments route)
  · VAT breakdown with a source badge per figure and a conflict banner · status timeline · actions
  (koppel document, upload, markeer als genegeerd, markeer als geboekt, verstuur naar SnelStart,
  bevestig match).
- **VAT position** = `vat_reclaimable` (Σ vat_cents over expenses with a resolved VAT source, by
  paid_at period) vs `vat_payable` (the kasboek's `computeBtwDashboard()` sales VAT for the same
  period) → estimated net; a negative net reads "naar verwachting terug te vorderen".
- Facturen inbox card: shows the linked expense (ref + status) for a finance thread.
- `insights.ts`: `unmatchedExpenseCount`, `missingInvoiceCount` (expenses waiting > 14 d),
  `expenseNeedsReviewCount`.
- Attachments route: `expense_document` source (admin-only; receipts carry personal data).

---

## 7. Security & ops

- All new tables RLS ON, no policies (service role only) — verified with the `information_schema` query.
- Receipt/link downloads: 15 MB cap, magic-byte type check, SSRF guard (no private/loopback targets),
  no cookies, no logins. Stored under server-generated keys only.
- No `PAY` scope needed; nothing here moves money. SnelStart forwarding sends a document, that's all.
- Crons: `revolut-sync` (existing, gains the expense step), `finance-snelstart-forward` (hourly), both
  behind `requireCronSecret`, failures via `alertCronFailure`; every state change → `finance_events`.
- Slack (`postSlackOps`, Beer's DM): a needs_review record (VAT conflict / near-tie / duplicate), and a
  daily one-liner when documents were forwarded to SnelStart.
- Money in integer cents everywhere. Display via the cockpit `money.ts` helpers.

---

## 8. Phases (each ships with tests; one PR at the end with the feature doc)

| Phase | Delivers | Key tests |
|---|---|---|
| **0 — Foundation** | Migration 160 (+ prod apply + types), `expenses/status.ts`, `expenses/vat.ts`, `expenses/normalize.ts` (names/amounts) | status table exhaustive; VAT preference + conflict + reverse-charge; name normalisation ("BOL.COM BV" ≈ "Bol.com") |
| **1 — Revolut side** | client `listExpenses`/`getExpenseReceipt` (binary), sync step, expense auto-creation from outgoing transactions (+ `ignored` via structural rules), receipt store + Gemini receipt extraction, backfill script | mocked client: pagination by `expense_date`, transaction_id join, receipt sniffing/cap, idempotent re-sync, structural-ignore |
| **2 — E-mail side** | Claude mail classifier/extractor, generic invoice prompt, image receipts, link detection + guarded fetch, documents from every finance-alias mail, upload-to-expense | classifier fixtures (Bol.com order mail, "invoice available" mail, payment confirmation); SSRF guard (private IPs, redirects, non-PDF); dedupe by hash |
| **3 — Matching** | `expenses/match.ts` + orchestrator both directions, duplicate rules, VAT resolution wired, status derivation on every change | Bol.com scenario end to end (A→C→matched), ice-cream receipt (B), invoice-before-payment (C), near-tie → review, never one-field matches |
| **4 — SnelStart** | Gmail attachments, forward cron + manual action, send log, auto-forward setting | MIME output; written-once send; gate (needs_review never sent); subject/body content |
| **5 — UI + KPIs** | Uitgaven page + drawer + KPI/VAT position, subnav, insights, attachments source, feature doc + README row | KPI aggregation (reclaimable vs payable per period); route contract test picks up new routes |
| **6 — Review** | `/review` on the whole diff, fix everything ≥ confidence 6, full suite + `tsc` green | — |

**Model:** Fable builds and reviews all of it in this session (Beer, 2026-09-05: "ga net zo lang door
tot het plan is afgemaakt"). The usual Sonnet-for-UI split is skipped for continuity.

---

## 9. Decisions taken (defaults — say so if any is wrong)

1. **Staff-sender mail stays on the payable pipeline**; every other finance-alias mail is an expense
   document. Paying a *supplier* invoice by transfer from an expense record is a follow-up, not v1.
2. **Auto-forward to SnelStart is on by default** but gated hard: only `ready_for_snelstart`
   (matched ≥ 0.90, VAT resolved, no conflict, real invoice/receipt). `needs_review` never auto-sends.
   Kill switch: `finance_settings.snelstart_auto_forward`.
3. **Invoice links are fetched only when plainly public PDFs**; portals that need a login are surfaced
   for manual download, never scraped.
4. **`booked` is manual in v1**; parsing SnelStart's own confirmation mails is later.
5. **Backfill covers 90 days** of outgoing transactions, dry-run first.
6. **Revolut VAT is the weakest source** (a rate, not an amount, chosen by hand in the app); an
   invoice or receipt figure always outranks it.
