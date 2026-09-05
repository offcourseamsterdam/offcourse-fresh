# Financial Management Module — Implementation Plan

**Date:** 2026-09-04
**Status:** BUILT — Phases 0–5 implemented 2026-09-04/05 (see docs/features/financial-management-module.md)
**Owner:** Beer
**Source PRD:** the "PRD — Financial Management Module" text (2026-09-04), the two UI mockups, and the loan export `loancashflowexport.md` (Investment Tracker, pulled 2026-09-04).

> The PRD and mockup say "Vestaam". Beer confirmed the company is **Off Course**; "Vestaam" is a
> placeholder name. This module lives in the Off Course admin at `/admin/finance/...`.

---

## 0. The one-paragraph version

Build a **cash cockpit** that answers "what can Off Course responsibly do with its money next?"
It reads the real Revolut Business balance, subtracts what is already spoken for (dated obligations,
loan payments, operating buffer, owner salary buffer, planned goals), and shows what is left before
and after a safety-margin threshold. Around that core sit four workflows: a Finance Inbox that
matches skipper invoices against shifts and pays them via Revolut, AI classification of every bank
transaction, goals and loans, and an investment what-if. Everything derives from **one pure
calculation** so every number on screen can be explained with a "Waarom?" click.

---

## 1. What exists today, and what we do with it

### 1.1 On `main` (keep, untouched)

| Thing | Verdict |
|---|---|
| `/admin/finance` page (3,475 lines) — kasboek tabs per payout source, BTW dashboard, city tax, partners, outgoing invoices | **Keep as-is.** This is bookkeeping (*what happened*). The new module is cash planning (*what can happen next*). They share a sub-nav, nothing else. |
| `src/lib/finance/*` parsers + summaries | Keep. New code goes in `src/lib/finance/cockpit/` so the two never tangle. |
| `revolut_transactions` table + CSV parser | Keep for VAT bookkeeping. **Do not reuse it for the bank feed** — it holds merchant-statement rows (payment links), not account transactions. New table `bank_transactions` (§4). |
| `staff`, `shifts`, `shift_bookings` (exist in prod + `types.ts`, migrations only on the ops branch) | Depend on them read-only for skipper matching. Do not add migration files for them here. |
| `ops_events` (in prod, unused on main) | Do not reuse. Finance gets its own small `finance_events` audit table (§4) — different lifecycle, different readers. |

### 1.2 On `feature/ai-ops-engine-main-sync` (the experiment, 4 commits on 2026-09-03)

Beer's instruction: *be strict, only take what helps.* Verdict per piece:

| Piece | Verdict | Why |
|---|---|---|
| `src/lib/finance/profit-cockpit-calculator.ts` (Profit-First % pots, 3-tier cost model, ALF scenario, marketing what-if) | **Drop entirely.** | The PRD explicitly forbids percentage-based allocation (§5, §28) and revenue-driven pots. It also mixes accounting profit into cash, which the PRD separates. Nothing to salvage; the new engine is ~300 lines and shaped completely differently. |
| `ProfitCockpitTab.tsx`, `CateringCostsTab.tsx`, catering `cost_price_value` | **Drop.** | COGS per extra is a margin question, not a cash question. Out of scope. (`extras.cost_price_value` was never applied to prod — nothing to clean.) |
| `finance_budget_settings` table (migrations 143–147, **already applied to prod**) | **Drop the table** in the first new migration. | It is percentage-shaped (`maintenance_pct`, `profit_first_profit_pct`, single-loan columns, `loans jsonb`). No code on `main` reads it. Replacing beats migrating. |
| `src/lib/revolut/auth.ts` (JWT client assertion, code exchange, refresh) | **Port with 3 fixes.** | The crypto and token flow are right. Fixes: (1) `iss` must be the **redirect-URI domain**, not the client ID (docs: "Domain from your OAuth redirect URI without https://"); the experiment would get 401 on first use. (2) Token cache is per-process memory — on Vercel each lambda would refresh independently, and Revolut **invalidates the previous access token on every refresh**, so instances would knock each other out. Tokens must live in the database (§4 `revolut_connection`). (3) Drop the `certs/` file fallback; PEM comes from env only. |
| `src/lib/revolut/client.ts` | **Rewrite, keep the interfaces.** | `fetch(..., { next: { revalidate: 60 } })` puts a bank balance in Next's data cache. Bank calls must never be cached by the framework. The static `REVOLUT_BUSINESS_API_KEY` path doesn't exist in Revolut's API (there is no static key); remove it. |
| `api/admin/revolut/setup` + `callback` routes | **Rewrite.** | Callback writes the refresh token into `.env.local` from a route handler — impossible on Vercel (read-only FS) and a secret-handling smell. Store it encrypted in `revolut_connection`. |

**Workflow note (decided 2026-09-04):** we build **inside the ai-ops branch**, in the existing worktree
`/Users/beer/Developer/offcourse-ai-ops-sync` on `feature/ai-ops-engine-main-sync` (tracks
`origin/feature/ai-ops-engine-main-sync`; 167 commits ahead of main, 12 behind at time of writing).
Reasons: the staff/shifts migrations and the scheduling code the invoice matcher depends on live
there, and the experiment can be deleted in place instead of being left behind. Phase 0 starts with
`git merge main` so the branch is current. The experiment's `auth.ts` is rewritten in place with the
fixes above; everything else from the experiment is `git rm`'d.

**Migration numbering:** the branch's last migration is `147_`. Finance migrations continue at
**`148_`** (`148_finance_core.sql`, `149_revolut_bank_feed.sql`, `150_finance_inbox.sql`,
`151_finance_investments.sql`).

---

## 2. Core model (the only formula in the product)

```
cleared cash (Revolut, EUR main account)
  − mandatory obligations due within the planning horizon      (taxes, loan payments, insurance,
                                                                  berth fees, approved-unpaid invoices)
  − operational coverage                                        (setting: minimum cash to keep operating)
  − owner salary coverage                                       (stored buffer, target = monthly × months)
  − planned goal funding                                        (Σ funded_cents of active goals)
  = financiële ruimte vóór veiligheidsmarge                     (may be negative)

financiële ruimte vóór veiligheidsmarge − gewenste veiligheidsmarge = beschikbaar voor groei
  if negative → beschikbaar voor groei = €0, tekort = margin − ruimte
```

Rules the engine enforces (each one is a unit test):

1. **Never double-count.** An amount lives in exactly one bucket. A loan payment is an obligation, never
   also a goal. Salary coverage is never inside operational coverage. An approved invoice is an
   obligation until its Revolut transaction is `completed`, then it stops being one.
2. **Only cleared cash counts.** Pending Revolut transactions are shown, never subtracted or added.
   Future revenue is never added.
3. **The bar reconciles.** The allocation bar fills buckets in priority order (obligations → operational
   → salary → goals → free) from cleared cash, so its segments always sum to cleared cash. If cash runs
   out before a bucket is filled, that bucket shows "onderdekt €X" and status becomes *Te krap*.
4. **Safety margin is a line, not a bucket.** Drawn as a threshold marker over the "free" segment.
5. **Same function everywhere.** Dashboard, "Waarom?" drawer, investment scenario, loan-impact modal
   and the AI answer all call `computeCockpit()` with different inputs. No second formula anywhere.
6. **Horizon is explicit.** `30d | 3m | 12m`, stored in settings, shown next to every derived number.
   Only obligations are horizon-scoped; coverage buffers and goal funding are not.

### 2.1 Why goal funding and salary coverage are *stored*, not derived

*Plain English:* a goal's "€6.400 gereserveerd" must stay €6.400 tomorrow even if cash moves,
otherwise Beer can't trust the number. So `funded_cents` is a real stored planning figure that only
changes on three events: Beer edits it, the monthly allocation cron tops it up from free cash, or a
linked purchase completes it. Same for the salary buffer: it goes down when a salary transaction is
classified, and the cron refills it. Every change writes a `finance_events` row, so "Bekijk
transacties" on a goal shows its full history.

The price of stored figures is that they can drift past reality (reserves > cash). The engine
detects that (`reserveOverrun`) and reports it as *Te krap* with the exact overrun — the PRD's
"never hide mismatches" (§38).

### 2.2 Worked example with Beer's real loans (today = 2026-09-04)

Loan payments fall on 1 April and 1 October. From the export, upcoming totals across all six loans:

| Date | Total (rente + aflossing) |
|---|---|
| 01-10-2026 | €6.366 |
| 01-04-2027 | €12.362 |
| 01-10-2027 | €11.686 |
| 01-04-2028 | €21.521 |

So the horizon alone changes the loan obligation from **€6.366 (30d and 3m)** to **€18.728 (12m)**.
This is exactly why the horizon must be visible next to every derived value (PRD §32).

---

## 3. Revolut Business API — facts that shape the design (verified 2026-09-04)

| Fact | Consequence |
|---|---|
| Auth = X509 cert uploaded in Business settings → Client ID; consent at `https://business.revolut.com/app-confirm?client_id=…&redirect_uri=…&response_type=code&scope=READ,WRITE`; code valid **2 minutes**; exchange at `POST /api/1.0/auth/token` with a JWT client assertion (`iss` = redirect-URI domain, `sub` = client ID, `aud` = `https://revolut.com`, RS256). | One-time connect flow in the admin. Redirect URI = `https://offcourseamsterdam.com/api/admin/finance/revolut/callback`, so `iss` = `offcourseamsterdam.com`. Private key PEM in env `REVOLUT_PRIVATE_KEY` (base64), never on disk. |
| Access token **40 min**; refresh token **does not expire** (per current guide). Refreshing **invalidates the previous access token**. | Store `access_token` + `expires_at` in DB; refresh when < 5 min left, under a row-level optimistic lock; retry once on 401. |
| Scopes: `READ`, `WRITE` (counterparties, webhooks, **payment drafts**), `PAY` (execute payments). | **v1 requests READ + WRITE only.** Payments go out as *payment drafts* that Beer approves in the Revolut app (2FA). `PAY` scope + `POST /pay` is a v2 opt-in (§9). |
| `GET /accounts` → `[{id, name, balance, currency, state, public, account_type}]`. | Cleared cash = `balance` of the EUR main account (`revolut_connection.account_id`). Snapshot every sync. |
| `GET /transactions?from&to&count(≤1000)&account&state[]&type` — newest first; page by using the last `created_at` as `to`. Transaction: `{id, type, state, request_id, created_at, updated_at, completed_at, reference, merchant{}, legs[{leg_id, account_id, amount, fee, currency, counterparty{}, description, balance}]}`. States: `created, pending, completed, declined, failed, reverted`. Types include `card_payment, transfer, fee, topup, refund, exchange, tax…`. | `bank_transactions` mirrors this; one row per transaction, amount taken from the leg on our EUR account. `state` transitions update the row (idempotent upsert on `revolut_id`). |
| Webhooks v2: `POST /webhooks {url, events}` → returns `signing_secret`. Events `TransactionCreated`, `TransactionStateChanged`. Headers `Revolut-Request-Timestamp` (ms) + `Revolut-Signature: v1=<hex HMAC-SHA256>`; reject if timestamp is > 5 min from now; retries 3× at 10-min intervals; **delivery may be duplicated or out of order**. | `/api/webhooks/revolut`: verify signature, dedupe on `(event, transaction id, timestamp)`, then **re-fetch the transaction by id** rather than trusting the payload. Sync cron remains the source of truth; webhook only makes it fast. Exact string-to-sign (`v1.{timestamp}.{body}`) to be confirmed against the *Manage webhooks* guide in Phase 2. |
| `POST /counterparty` (company or individual; IBAN + BIC + name + address). `POST /payment-drafts {title, payments:[{account_id, receiver:{counterparty_id}, amount, currency, reference}]}`. | Skipper = supplier with a Revolut counterparty. Approve in our UI = create draft; Beer approves in the app; the resulting transaction arrives through the feed and is matched back to the invoice by counterparty + amount + reference. |
| Sandbox exists (`sandbox-b2b.revolut.com`, separate cert + consent). | Phase 2 is built and tested against sandbox first; `revolut_connection.environment` switches base URL. |

---

## 4. Data model (all new tables: RLS ON, zero policies = service-role only)

Migration files: `148_finance_core.sql`, `149_revolut_bank_feed.sql`, `150_finance_inbox.sql`,
`151_finance_investments.sql`. Regenerate `types.ts` after each.

```
finance_settings            (single row id='default')
  planning_horizon           text  '30d'|'3m'|'12m'      default '3m'
  safety_margin_cents        int                         default 2000000
  operational_coverage_cents int                         default 0     -- Beer sets; UI hints "≈ 1 maand operationele kosten = €X" from classified spend
  owner_salary_monthly_cents int
  owner_salary_months        int   1|2|3|4|6             default 3
  owner_salary_coverage_cents int                        default 0     -- the stored buffer (§2.1)
  manual_cash_cents / manual_cash_at                                   -- ONLY used while Revolut is not connected; UI labels it "handmatig, {date}"
  allocation_priority        jsonb                        default ["obligations","operational","owner_salary","goals"]

finance_obligations
  id, title, kind ('tax'|'loan'|'insurance'|'berth'|'salary'|'contract'|'invoice'|'other')
  amount_cents, due_date, recurrence_months (null|1|3|12), recurrence_until
  boat_id (null = shared), loan_id (null), invoice_id (null)
  status ('open'|'paid'|'cancelled'), paid_transaction_id, paid_at, notes
  -- loan-generated rows are written by the loan schedule sync; invoice rows by the inbox approve step

finance_loans
  id, name, lender_name, principal_cents, interest_rate_pct, duration_years, interest_free_years
  repayment_type ('linear'|'annuity'|'interest_only'), start_date, tranches jsonb [{amount_cents,date,note}]
  status ('active'|'closed'), notes
finance_loan_payments                                   -- materialised schedule, one row per (loan, period)
  loan_id, due_date (Apr 1 / Oct 1), interest_cents, principal_cents, total_cents
  is_paid, paid_transaction_id, paid_at
  UNIQUE (loan_id, due_date)

finance_goals
  id, name, description, target_cents, funded_cents, deadline, priority (1..5)
  monthly_funding_cents, boat_id, status ('active'|'completed'|'paused'), flexibility ('fixed'|'flexible')
  completed_transaction_id, created_at

finance_events                                          -- append-only audit for every planning change
  id, occurred_at, event_type, actor ('user'|'cron'|'ai'|'webhook'), entity_type, entity_id
  delta_cents, payload jsonb

revolut_connection          (single row)
  environment ('sandbox'|'production'), client_id, redirect_uri
  refresh_token_enc, access_token_enc, access_token_expires_at     -- AES-256-GCM with REVOLUT_TOKEN_KEY
  account_id (EUR main), account_name
  webhook_id, webhook_secret_enc
  last_sync_at, last_sync_error, consented_at, scopes text[]

revolut_balance_snapshots
  taken_at, account_id, balance_cents, source ('sync'|'webhook')

bank_transactions
  id, revolut_id UNIQUE, request_id, type, state, created_at, updated_at, completed_at
  amount_cents (signed, our leg), fee_cents, currency, reference, description
  counterparty jsonb, merchant jsonb, raw jsonb
  -- classification (§7)
  category, subcategory, boat_id, goal_id, obligation_id, invoice_id, loan_payment_id
  classified_by ('rule'|'ai'|'user'|null), confidence numeric, needs_review bool, reviewed_at
  vat_cents (optional, for later hand-off to kasboek)

finance_classification_rules
  id, match_field ('counterparty_name'|'description'|'reference'), pattern (ilike), category, subcategory
  boat_id, goal_id, created_from_transaction_id, hit_count, created_at

finance_suppliers
  id, name, staff_id (null for non-skippers), iban, bic, revolut_counterparty_id
  default_category, default_boat_id, is_active

finance_invoices
  id, supplier_id, status ('received'|'extracted'|'needs_review'|'ready'|'approved'|'payment_pending'|'paid'|'reconciled'|'rejected')
  file_path (private bucket 'finance-attachments', reuse attachment-storage.ts), uploaded_at, source ('upload'|'email')
  extracted jsonb  {invoice_number, invoice_date, supplier_name, iban, tour_date, booking_ref, hours, rate_cents, amount_cents, vat_cents, confidence:{field:0..1}}
  matched_shift_id, matched_booking_id, expected_amount_cents
  checks jsonb     [{key:'skipper'|'booking'|'date'|'amount'|'duplicate'|'iban'|'hours'|'rate', ok:bool, detail}]
  decision ('approved'|'approved_override'|'rejected'), decided_by, decided_at, decision_note
  revolut_draft_id, paid_transaction_id, obligation_id

finance_investments
  id, title, amount_cents, boat_id, type ('growth'|'capacity'|'efficiency'|'maintenance'|'upgrade'|'risk'|'strategic')
  impact jsonb {capacity, revenue, savings, reliability, lifespan, risk, urgency, confidence: 1..5 + notes}
  expected_return_cents (nullable — "niet betrouwbaar te kwantificeren" when null)
  status ('idea'|'planned'|'approved'|'executed'|'dropped'), executed_transaction_id, goal_id
```

`staff` gets nothing new: supplier ↔ staff is a FK on `finance_suppliers`, so we never touch the
ops branch's tables.

---

## 5. Code layout

```
src/lib/finance/cockpit/
  types.ts
  compute.ts               pure: computeCockpit(inputs) → {cash, buckets[], space, growth, shortfall,
                                   reserveOverrun, status, why[]}
  obligations.ts           pure: expandObligations(rows, loanPayments, invoices, horizon, today)
  loans/schedule.ts        pure: buildSchedule(loan) — port of the Investment Tracker engine
  goals.ts                 pure: goalProgress(goal, today) → {pct, behindCents, monthsLeft}
  allocation.ts            pure: planMonthlyAllocation(cockpit, goals, settings) → proposed deltas
  insights.ts              pure: buildInsights(cockpit, goals, invoices, mismatches)
  status.ts                pure: deriveStatus(...)
  classify/taxonomy.ts     the category tree from PRD §22 (one const)
  classify/rules.ts        pure: applyRules(tx, rules)
  classify/ai.ts           Claude call, returns {category, subcategory, boat?, goal?, confidence, reason}
  invoices/extract.ts      Gemini PDF → extracted jsonb (+ confidence, 'Niet gevonden' for missing)
  invoices/match.ts        pure: matchInvoice(extracted, supplier, candidateShifts, existingInvoices) → checks[]
  load-cockpit.ts          server: Supabase → inputs → computeCockpit (the only place that reads the DB for the dashboard)

src/lib/revolut/
  auth.ts                  JWT assertion, exchange, refresh (ported + fixed)
  token-store.ts           DB-backed token with refresh lock
  client.ts                accounts, transactions, counterparties, payment drafts, webhooks
  webhook-signature.ts     pure: verify(headers, rawBody, secrets[])
  sync.ts                  pull balance + transactions since (last_sync − 7d), upsert, return new/changed ids
  crypto.ts                AES-GCM encrypt/decrypt with REVOLUT_TOKEN_KEY

src/app/api/admin/finance/cockpit/
  overview/route.ts                  GET  → computed cockpit (+ why)
  settings/route.ts                  GET/PUT
  obligations/route.ts, [id]         CRUD, mark-paid
  loans/route.ts, [id], [id]/schedule, [id]/impact (POST: what-if before saving)
  goals/route.ts, [id], [id]/events
  transactions/route.ts, [id]/classify (PUT: user correction → optional rule)
  invoices/route.ts (POST upload), [id], [id]/approve, [id]/reject, [id]/pay (creates draft)
  suppliers/route.ts, [id]
  investments/route.ts, [id], scenario (POST)
  revolut/status, revolut/connect (GET → authorize URL), revolut/callback (GET), revolut/disconnect, revolut/sync (POST manual)
  ask/route.ts                        POST question → Claude with cockpit JSON in context
src/app/api/webhooks/revolut/route.ts
src/app/api/cron/revolut-sync/route.ts                (*/15 min)
src/app/api/cron/finance-monthly-allocation/route.ts  (1st of month 06:00)
src/app/api/cron/finance-missing-invoices/route.ts    (weekly)

src/app/[locale]/admin/finance/
  page.tsx                (existing kasboek — unchanged, gets the FinanceSubnav on top)
  overview/page.tsx       Financieel overzicht (the dashboard)
  transactions/page.tsx
  goals/page.tsx
  loans/page.tsx
  investments/page.tsx
  (no inbox/page.tsx — see §6a: the Finance Inbox is a view inside the existing /admin/inbox, not a new page)
src/components/admin/finance/cockpit/
  FinanceSubnav, StatCard (new shared), AllocationBar, WhyDrawer, StatusPill,
  GoalCard/GoalModal, ObligationsCard, TransactionsCard/TransactionReviewModal,
  InsightsCard, LoanModal/LoanImpactModal, InvoiceRow/InvoiceReviewModal, InvestmentScenario
```

Every `/api/admin/**` route starts with `requireAdmin()` (contract test). Routes use the plain
`export async function GET/POST` shape so `admin-route-contract.test.ts` sees them without changes.

---

## 6. Finance Inbox — how matching works

```
PDF (upload, or email — see §6a) → finance-attachments bucket → finance_invoices(received)
  → Gemini extraction (extracted jsonb + per-field confidence)                → extracted
  → supplier resolved by IBAN, then name (else needs_review: "Leverancier onbekend")
  → candidates = shifts where staff_id = supplier.staff_id and date within ±3d of tour_date
                 (or booking_ref match), status ≠ cancelled
  → expected = hours(shift) × staff.hourly_rate_cents   (rate snapshot at match time, stored)
  → checks: skipper ✓  booking ✓  date ✓  hours ✓  rate ✓  amount ✓  duplicate ✓  iban ✓
  → all ok  → ready   ("Goed om te betalen")
     any ✗  → needs_review, with the diff spelled out ("Afgesproken €450, factuur €550, +€100")
  → Goedkeuren → approved + finance_obligations row (kind='invoice', due = invoice due date or +14d)
  → Goedkeuren & betalen → Revolut payment draft → payment_pending (Beer approves in the Revolut app)
  → feed sees the completed transfer → invoice_id set on bank_transactions → paid → obligation paid → reconciled
```

This pipeline (extraction → match → checks → approve → pay → reconcile) is unchanged regardless of how
the PDF arrives. §6a is only about *delivery*: how the PDF gets into `finance-attachments` in the first
place.

Rejected or overridden decisions are stored with a note; overrides never edit the extracted data.

**Data dependencies to be honest about**

- Matching needs `shifts.staff_id` filled. Today: 12 assigned, 90 open. Until scheduling assigns
  shifts, the modal offers "Koppel handmatig aan boeking".
- Agreed rates: `staff.hourly_rate_cents` is 0 for Bas, Bo, Jannah and Mare. Missing rate → check
  fails with "Geen afgesproken tarief" (never silently accept). Beer fills these in on `/admin/scheduling`
  (Staff tab) or directly in the table before Phase 4 ships.
- Missing-invoice insight: shifts with `staff_id`, end < today − 14d, no `finance_invoices.matched_shift_id`.

## 6a. Delivery: reuse the operations inbox instead of a new Finance Inbox UI (decided 2026-09-04)

Beer's instruction: *"die UI daarvoor kunnen we de UI gebruiken uit de inbox van de operations email.
gewoon een ander ontvangend mailadres en klaar."* Investigated before committing to it (agent research,
2026-09-04) — the reuse is real and worth doing, but it is **not** "just a different address": the
existing `GMAIL_SUPPORT_ADDRESS` is a single value, nothing today parses the `To:` header to know which
address a message arrived on, and the inbox has **never ingested an attachment** — every existing Gmail
message is text-only (`src/lib/gmail/client.ts`'s `GmailMessage` has no `attachments` field). Three
small, well-scoped additions close that gap; everything else (the three-pane shell, the AI-summary
pipeline, the channel-agnostic `conversations`/`messages` schema, the cron+push sync architecture) is
already exactly right and needs no change.

**What's a clean drop-in (build nothing new):**
- `src/app/[locale]/admin/inbox/{page,ConversationList,ThreadPane}.tsx` — the three-pane shell.
- `conversations` / `messages` (migration `070_customer_chat.sql` + later additions) — "new rows, not
  new tables" is the documented philosophy (`docs/features/customer-chat-inbox.md`) and it holds here.
- `src/lib/gmail/summarize.ts` — the Haiku one-line summary works the same for a finance thread.
- The sender-pattern-detection idiom in `src/lib/ota/detect.ts` is the template for `finance/detect.ts`.
- The `finance-attachments` bucket + `src/lib/finance/attachment-storage.ts` (private, 5-min signed
  URLs) — built for manually-uploaded payout PDFs, reused as-is as the storage target for
  email-delivered invoice PDFs too.

**What's genuinely new (small, three pieces):**
1. **A dedicated address + `To:`-header parsing.** New env var `GMAIL_FINANCE_ADDRESS` (e.g.
   `facturen@offcourseamsterdam.com`), added alongside `GMAIL_SUPPORT_ADDRESS` in `inboxQuery()`'s
   Gmail search. `src/lib/gmail/client.ts` currently never reads the `To` header (Gmail API already
   returns it in `payload.headers`, just unused) — add that, then `finance/detect.ts` decides
   `source_category` from it. Because this address is money-adjacent, `finance/detect.ts` also checks
   the *sender* against known suppliers/skippers, the same way `ota/detect.ts` checks sender domains —
   an email arriving at `facturen@` from an unknown sender is flagged for review, never auto-trusted,
   matching §17's "AI should never silently invent" rule for the extraction step itself.
2. **A `conversations.source_category` column** (new migration, next number after 154 in sequence —
   this table lives outside the `finance_*` migration range, so it gets its own number when written),
   parallel to the existing `ota_source` column, plus a `'finance'` entry in `ConversationList.tsx`'s
   `SOURCE_FILTERS`.
3. **Attachment ingestion, gated to `source_category = 'finance'` only.** A new step in
   `syncGmailInbox()` fetches attachment parts via the Gmail API for finance-category messages only
   (customer/OTA/catering mail stays text-only, unchanged), stores each PDF into `finance-attachments`
   via the existing helper, and creates a `finance_invoices` row with `source_message_id` pointing back
   at the `messages` row — so a PDF that arrived by email and one uploaded by hand run through the exact
   same extraction/match/approve pipeline above.

**UI:** no new `/admin/finance/inbox` route. A finance thread's `ContextPane` (today's slot for the
Ghost co-pilot's booking suggestions) gets a new card type — "Factuur controleren" — showing the same
match/checks UI from the pipeline above (skipper ✓ booking ✓ date ✓ hours ✓ rate ✓ amount ✓) with
Goedkeuren / Goedkeuren & betalen buttons, right where Beer is already reading the email.

---

## 7. Transaction classification

Small taxonomy (PRD §22) in one constant. Order of resolution for every new/changed transaction:

1. **Structural rules first (deterministic):** internal transfer between own accounts → `transfer`;
   `type='fee'` → operating/bank fee; a completed transfer to a supplier counterparty with a matching
   `finance_invoices.revolut_draft_id` or reference → that invoice; a payment to a lender on a loan
   due date ± 5d for the scheduled amount → that loan payment; card payments from Stripe/FareHarbor
   payout names → income/booking revenue.
2. **User rules** (`finance_classification_rules`, ilike on counterparty/description) — created when
   Beer corrects a classification and ticks "onthoud dit".
3. **Claude Sonnet** for the rest, with the taxonomy, the boats, active goals and the last 20 user
   corrections in the prompt. Returns category + boat + goal suggestion + confidence + one-line reason
   (the "Waarschijnlijk onderhoud aan Curaçao — 87%" text).
4. Thresholds: rule = auto; AI ≥ 0.90 auto; 0.60–0.89 shown as suggestion (`needs_review` = true, applied
   provisionally); < 0.60 unclassified, "Controle nodig".

Allocation side-effects (only on `state = completed`):

- category `owner/salary` → `owner_salary_coverage_cents -= amount` (floor 0) + event
- linked `goal_id` on an outgoing transaction → goal `completed` if amount ≥ remaining target, else
  `funded_cents -= amount` + event; overage is shown, never a negative goal
- linked `obligation_id` / `loan_payment_id` → marked paid
- everything else: no planning effect (cash itself already moved)

Bank-side reconciliation (PRD §38): after each sync, `balance_at_last_snapshot + Σ completed amounts
since` must equal the new balance within the fee rounding. If not, `revolut_connection.last_sync_error`
records the gap and the dashboard shows "Afwijking €X — Y transacties nog niet verwerkt / in
behandeling". Never absorbed into free cash.

---

## 8. Dashboard (Financieel overzicht) — what renders

Follows mockup 1 (light, rounded cards, navy sidebar is the existing admin shell). Dutch labels from
the PRD. Mobile-first: KPI cards stack, the allocation bar becomes a stacked list under 640px.

1. Header: title, "Laatst bijgewerkt {sync time}", horizon selector (30d / 3m / 12m), `Ververs` (manual sync).
2. KPI row: **Cash bij Revolut** (+ "waarvan €X in behandeling"), **Financiële ruimte vóór
   veiligheidsmarge**, **Beschikbaar voor groei** (green; or "€0 · €X onder veiligheidsmarge"), **Komende
   verplichtingen** ("in de komende 3 maanden").
3. Status pill: Financieel gezond / Let op / Te krap, with the one-line reason.
4. **Waar is je geld voor bestemd?** — AllocationBar: Verplichtingen · Operationeel · Eigenaarssalaris ·
   Doelen · Vrij, threshold marker "Gewenste veiligheidsmarge €X". Segments sum to cleared cash.
   Underfunded bucket hatched with "onderdekt".
5. Three cards: Komende verplichtingen (list, due dates, per-boat tag) · Doelen (progress, "€600 achter
   op schema") · Eigenaarssalaris (X van Y maanden gedekt).
6. Two cards: Recente transacties (with classification chip + confidence) · Wat vraagt aandacht?
   (insights only when actionable).
7. Every KPI opens the **WhyDrawer**: horizon, cash, each deduction as a line, the subtraction, the margin
   step, the result. Same JSON the API returned — no client-side math.

Before Revolut is connected the cash card reads "Handmatig ingevoerd op {date}" with an inline
"Koppel Revolut" button. Nothing else changes.

---

## 9. Phases (each is a PR, each ships with tests + a docs/features entry)

| Phase | Delivers | Key tests |
|---|---|---|
| **0 — Foundations** (½ day) | In the ai-ops worktree: `git merge main`. **Delete the experiment**: `profit-cockpit-calculator.ts` (+test), `catering-costs.ts` (+test), `ProfitCockpitTab.tsx`, `CateringCostsTab.tsx`, `api/admin/finance/profit-cockpit/*`, `api/admin/revolut/*`, `revolut/client.ts` (+test); revert the extras cost-price UI from commit `4332d75` (`ExtrasFormModal`, `ExtrasTable`, extras `types.ts`, `api/admin/extras/*`) because `extras.cost_price_value` never reached prod and those writes would fail. Migration `148`: drop `finance_budget_settings`, `DROP COLUMN IF EXISTS extras.cost_price_value`; create settings/obligations/loans/loan_payments/goals/events. Types regenerated. `FinanceSubnav` on the existing kasboek page. Feature-doc skeleton. | `npm test` green after deletions; `admin-route-contract` still green; RLS check query for new tables. |
| **1 — Engine + loans + dashboard v0** (2–3 days) | `compute.ts`, `obligations.ts`, `loans/schedule.ts`, `goals.ts`, `status.ts`. Settings, obligations, loans, goals CRUD + pages. Dashboard with manual cash. Loan seed script for the 6 real loans. WhyDrawer. Loan-impact modal (`/loans/impact`). | Loan engine reproduces the export tables to the cent (Tijs bullet, Jelka linear, Irma `interestFree == duration`, Enrico tranches: 2025 interest €10, Erik starting exactly on a payment date so 2026 = one €2.494 period, Tijs mid-period start pro-rata €127 in 2025). Horizon expansion (30d/3m/12m loan totals above). Reconciling bar. Negative space → €0 growth + shortfall. Double-count guards. |
| **2 — Revolut feed** (2–3 days) | Cert + consent flow (admin "Koppel Revolut" → callback → encrypted tokens). `token-store` with refresh lock. `sync.ts` + cron (15 min). Webhook route. `bank_transactions` + snapshots. Transactions page (raw, unclassified). Cash card goes live. Bank-side reconciliation. Built on **sandbox** first, then production cert. | Signature verifier (valid, tampered, stale timestamp, rotated-secret dual signatures). Sync upsert idempotency + state transitions. Pagination by `created_at`. Token refresh race (two callers, one refresh). Route tests with mocked Supabase. |
| **3 — Classification + linking** (2 days) | Taxonomy, rules, Claude classifier, review modal, boat/goal/obligation linking, salary depletion, goal completion, "onthoud dit" rules. Slack ops alert on sync failure / reconciliation gap. | Rule precedence; threshold routing; side-effects only on `completed`; goal overage never negative; salary floor 0. |
| **4 — Finance Inbox** (3 days) | §6a delivery: `GMAIL_FINANCE_ADDRESS` + `To:`-header parsing, `finance/detect.ts`, `conversations.source_category`, gated attachment ingestion into `finance-attachments`. Then the unchanged §6 pipeline: suppliers (+ Revolut counterparty creation), Gemini extraction, `match.ts`, the "Factuur controleren" `ContextPane` card (approve/reject/override), obligation creation, payment draft, paid→reconciled via feed, missing-invoice cron. Manual upload stays as a fallback for a PDF that never went through Gmail. | `match.ts` on fixtures: exact match, +€100, wrong hours, wrong rate, duplicate number, IBAN changed, no rate on staff, no shift. Extraction returns `Niet gevonden` for absent fields (mocked Gemini). Status machine transitions. `finance/detect.ts` on fixtures: known supplier → auto-category, unknown sender at the finance address → flagged, a message to the old support address never gets the finance category. |
| **5 — Allocation, insights, investments** (2 days) | Monthly allocation cron (proposals applied only when free cash covers them; events written; Slack DM summary). `insights.ts`. Investments page + scenario (before/after via the same `computeCockpit`). Safety-margin warning. | Allocation never exceeds free cash; priority order; insight rules produce exactly the PRD sentences; scenario = compute(cash − amount). |
| **6 — Nice-to-have** | "Vraag het aan de AI-assistent" (Claude + cockpit JSON, must state horizon/cash/deductions/margin). Inbound invoice email via Resend (`facturen@…` → inbox). `PAY` scope + direct `POST /pay` behind a setting, with a typed confirmation. Per-boat cost view. | Prompt contract test (answer contains horizon + margin). |

Estimated total for phases 0–5: ~2.5 weeks of focused work. Phase 1 alone already replaces the
experiment with something Beer can use (manual cash + real loans + goals).

---

## 10. Security and ops checklist

- All new tables: `ENABLE ROW LEVEL SECURITY`, no policies (service role only). Verified in Phase 0 with an `information_schema` query, since nothing checks it automatically.
- Secrets: `REVOLUT_CLIENT_ID`, `REVOLUT_PRIVATE_KEY` (base64 PEM), `REVOLUT_TOKEN_KEY` (32-byte AES key), `REVOLUT_ENV` (`sandbox|production`). Added to `.env.example`. Refresh/access tokens and webhook secret only in DB, encrypted.
- Scopes READ + WRITE in v1. No PAY. Payment drafts require Beer's approval in the Revolut app, so a compromised Vercel env cannot move money.
- Webhook: signature + 5-minute timestamp window + idempotency; on any doubt, ignore and let the 15-minute sync catch up.
- Never `next: { revalidate }` or `unstable_cache` around bank calls. All cockpit API routes `export const dynamic = 'force-dynamic'`.
- Slack: sync failures, reconciliation gaps, invoices needing review, monthly allocation summary → `postSlackOps()` (Beer's DM). Nothing to `#bookings`.
- Money in cents everywhere (`_cents` columns, `toCents` helper). Display via `fmtAdminAmount`.
- Crons registered in `vercel.json`, guarded by `require-cron-secret`, failures through `alertCronFailure`.

---

## 11. Explicitly out of scope for v1 (PRD §46, plus repo-specific)

- No profit/margin model, no percentage pots, no revenue forecast — the experiment's cockpit is not carried over.
- No accounting export; the kasboek tabs remain the bookkeeping surface. (Later: hand classified `bank_transactions` with `vat_cents` to the BTW dashboard.)
- No multi-currency; EUR main account only. Other Revolut accounts/pockets are listed in settings but excluded from cleared cash unless ticked.
- No payroll: skipper invoices are matched, not generated. Self-billing is a scheduling-project question.
- No edits to `staff`/`shifts` schema.

---

## 12. Decisions taken (assumed defaults — say so if any is wrong)

1. **Payments via Revolut payment drafts** (approve in app), not direct API payments. Safer, and the PRD's approval requirement is satisfied by the bank itself.
2. **Cleared cash = the EUR main account balance from `GET /accounts`**; pending = Σ our transactions in `pending`/`created`. To be validated against sandbox behaviour in Phase 2.
3. **Goal funding and salary coverage are stored planning figures**, changed only by explicit events (§2.1). The horizon scopes obligations only.
4. **Dutch UI copy** for this module (matches PRD and mockups; the kasboek tabs already mix in Dutch).
5. **Sandbox first** for Phase 2; production cert added when drafts + webhooks are proven.
6. **Built on the ai-ops branch/worktree**, migrations continue at 148. (Superseded the earlier idea of a fresh branch from main.)
7. **Investment Tracker (Firebase) stays the loan source of truth for now**; we seed its six loans once and edit here afterwards. If Beer wants a live link later, the export format is already the contract.

## 12b. Derived obligations and batch payouts (added 2026-09-04, after Beer's feedback)

The cockpit was only as good as what Beer typed into it. Three commitments are already knowable
from data we hold, and one of them is money that is not his at all.

| Source | Rhythm | Status | Where the number comes from |
|---|---|---|---|
| City tax | quarterly | **built** (`derived/city-tax.ts`) | `bookings.guest_count` × the per-guest rate, yearly exemption consumed chronologically |
| Standing charges (insurance, berth, subscriptions) | detected per charge | **built** (`derived/recurring.ts`) | the bank feed itself: same counterparty, steady interval, stable amount |
| Skipper hours | monthly | **built, starved of data** (`derived/skipper-hours.ts`) | `shifts` + `time_entries`, priced at the rate frozen at clock-in |
| Catering purchasing | per cruise | **blocked** | needs a cost price per extra; `extras.cost_price_value` was deliberately dropped in Phase 0 |

Rules that keep these from corrupting the formula:

1. **Derived obligations are proposals until confirmed.** Auto-creating them would double-count
   against anything Beer entered by hand for the same thing. The obligations modal is where a
   proposal becomes a row.
2. **An accrual is replaced by its invoice, never added to it.** When a skipper invoice arrives in
   Phase 4 for a month that already has an accrued obligation, the invoice supersedes it. Otherwise
   the same hours are owed twice.
3. **A running period is included but labelled.** Q3's city tax is real money already collected,
   so hiding it until the quarter closes is the exact error this exists to prevent. Its title says
   it is still accruing.
4. **A gap is reported, never rounded away.** City tax names the bookings it could not count, and
   the skipper accrual names anyone whose hours have no rate rather than pricing them at zero.

**Batch payouts.** Revolut takes several payments in one draft as long as they leave the same
account, which matches the monthly skipper run exactly: one draft, one line per skipper, one
approval in the Revolut app. `buildPayoutRun()` already produces those lines and holds back anyone
who cannot be priced. Wiring it to `POST /payment-drafts` is Phase 4 work, sharing the code path
the Finance Inbox uses for supplier invoices.

**UI consequences** (Beer, 2026-09-04):
- Drop the owner-salary card from the dashboard; those settings move into the settings modal.
- "Komende verplichtingen" gets a modal that manages every obligation, including a section to
  read in the detected standing charges: name, interval, amount, next date, confirm or dismiss.

### 12c. Follow-up answers (Beer, 2026-09-04)

- **FareHarbor's monthly charge is genuinely variable** — confirmed, `amountVaries: true` already
  flags it (fee scales with booking volume).
- **Catering purchasing:** no invoice data yet, but sell price is always cost × 1.30. Built
  `derived/catering-cost.ts` as an explicit *estimate* (`estimateCateringSpend`), never a stored
  obligation or a transaction classification — Phase 4's real purchase invoices supersede it outright.
- **"MG is Mia":** the bank often prints a nickname instead of the real name. Added
  `staff.payment_aliases text[]` (migration 152) and alias matching in `classifyStructural()`.
  **Mia is not in the `staff` table yet** — her alias can't be set until she's added there.
- **BTW (high/low) as an obligation:** yes. `derived/vat.ts` wraps the existing
  `computeBtwDashboard()` (already nets 9%/21% across all ten kasboek sources) into obligation
  proposals, mirroring `city-tax.ts`. A net refund quarter is never proposed as owed.
- Added obligation kind `'crew'` (migration 153) so skipper-hours accruals show as bemanning,
  not "overig".

## 13. Which model builds which phase

The plan is written so each phase is specified tightly enough for a cheaper model to execute; the
tests are the safety net, not the model. Suggested split:

| Work | Model | Why |
|---|---|---|
| Phase 0 (deletions, migration, RLS) and Phase 1 engine (`compute.ts`, `obligations.ts`, `loans/schedule.ts`) | Fable or Opus | Money math with double-count and rounding traps; a subtle bug here poisons every screen. Worth the strongest model once, with the export tables as oracle. |
| Phase 2 Revolut auth, token store, webhook signature, sync | Fable or Opus | Security + concurrency (token refresh race, replay window, idempotency). Mistakes are silent in dev and loud in prod. |
| Phase 1/3/4/5 UI, CRUD routes, modals, pages | Sonnet | Pattern-following work with clear examples in the repo (`AdminFormModal`, `useAdminFetch`, route shapes). Fast and cheap. |
| `match.ts`, `classify/rules.ts`, `insights.ts` | Opus | Pure logic with fixtures; medium difficulty. |
| Reviews before each PR (`/review`) | Fable | Catching what the builder missed is where the strongest model earns its cost. |

Run each phase in its own session with this plan file plus `docs/features/financial-management-module.md`
in context, so the builder never has to rediscover decisions.

## 14. Open items for Beer (not blocking Phase 0–1)

- Fill `staff.hourly_rate_cents` for Bas, Bo, Jannah, Mare.
- Owner salary amount and months (experiment default was €3.500 × 3).
- Operational coverage starting value (suggest 1 month of 2025's average operating spend; the UI will compute a hint once transactions are classified).
- Safety margin starting value (PRD examples use €12.800 and €20.000).
- Which mailbox skipper invoices arrive in today, for the Phase 6 forwarding address.
- Confirm the Revolut EUR account to treat as "main" once connected (settings will list them).
