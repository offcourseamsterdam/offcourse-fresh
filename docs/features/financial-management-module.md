# Financial Management Module (cash cockpit)

**Status:** in progress — Phases 0, 1 and 2 built (2026-09-04). Plan: `docs/plans/2026-09-04-financial-management-module.md`.

## What was built

A cash-planning module for the admin, separate from the kasboek bookkeeping tabs. It answers
"what can Off Course responsibly do with its money next?" by taking the real Revolut balance and
subtracting what is already spoken for: dated obligations (taxes, loan payments, insurance, approved
invoices), an operating buffer, an owner-salary buffer and planned goals. What is left is
*financiële ruimte vóór veiligheidsmarge*; minus the configurable safety margin it becomes
*beschikbaar voor groei*.

- **Phase 0** removed the earlier Profit-First experiment (percentage pots, `finance_budget_settings`)
  and created the planning tables.
- **Phase 1** is the engine (one pure formula), the loan schedule port with the six real investor
  loans seeded, obligations, goals, the admin API and the dashboard/goals/loans pages.
- **Phase 2** connects Revolut Business: certificate + OAuth consent, encrypted token store, a
  15-minute sync of balance and transactions, a signed webhook receiver, and a transactions list.

## Key files

| File | Purpose |
|---|---|
| `supabase/migrations/148_finance_core.sql` | Planning tables: `finance_settings`, `finance_loans`, `finance_loan_payments`, `finance_obligations`, `finance_goals`, `finance_events`. RLS on, no policies. |
| `supabase/migrations/149_revolut_bank_feed.sql` | `revolut_connection` (single row, encrypted secrets, refresh lock), `revolut_balance_snapshots`, `bank_transactions`, `revolut_webhook_events`. |
| `src/lib/finance/cockpit/compute.ts` | **The formula.** `computeCockpit(inputs)` → buckets (waterfall), financial space, available for growth, shortfalls, status, "Waarom?" lines. Pure. |
| `src/lib/finance/cockpit/obligations.ts` | Horizon end (30d/3m/12m) and expansion of one-off/recurring obligations + unpaid loan payments into dated occurrences. |
| `src/lib/finance/cockpit/loans/schedule.ts` | Loan schedule engine (1 Apr / 1 Oct cadence, pro-rata first period, linear/annuity/interest-only, tranches). Tested against the Investment Tracker export. |
| `src/lib/finance/cockpit/loans/materialize.ts` | Writes a schedule into `finance_loan_payments`; paid rows are never touched. |
| `src/lib/finance/cockpit/goals.ts` | Goal progress and behind-schedule maths. |
| `src/lib/finance/cockpit/load-cockpit.ts` | The only DB reader for the dashboard. Cash = latest Revolut snapshot when connected, else the manual balance. `loadCockpitInputs()` is reused by what-if screens. |
| `src/lib/finance/cockpit/events.ts`, `schemas.ts`, `rows.ts` | Audit log helper, zod request schemas, DB→engine mappers. |
| `src/app/api/admin/finance/cockpit/**` | Admin API: `overview`, `settings`, `obligations`, `loans` (+ `impact`), `goals`, `transactions`, `revolut/*`. All start with `requireAdmin()`. |
| `src/lib/revolut/auth.ts` | JWT client assertion (`iss` = redirect-URI domain), code exchange, refresh, consent URL, sandbox/production bases. |
| `src/lib/revolut/crypto.ts` | AES-256-GCM for secrets at rest (`REVOLUT_TOKEN_KEY`). |
| `src/lib/revolut/token-store.ts` | The single token store (DB row + refresh lock). `createRevolutClient()` for server code. |
| `src/lib/revolut/client.ts` | Typed API client: accounts, transactions (paged), counterparties, payment drafts, webhooks v2. Never cached. |
| `src/lib/revolut/sync.ts`, `cash.ts` | Balance snapshot + 7-day look-back transaction upsert; `CashInput` for the engine. |
| `src/lib/revolut/webhook-signature.ts` | HMAC verification (`v1.{timestamp}.{raw body}`), replay window, dedupe key. |
| `src/app/api/webhooks/revolut/route.ts` | Webhook receiver: verify → dedupe → re-fetch by id → upsert → snapshot. |
| `src/app/api/cron/revolut-sync/route.ts` | Every 15 minutes (`vercel.json`). The source of truth; webhooks only make it faster. |
| `scripts/finance/seed-loans.ts` | One-time loan import (`npm run finance:seed-loans`, dry-run by default). |
| `src/app/[locale]/admin/finance/{overview,goals,loans}/page.tsx`, `src/components/admin/finance/cockpit/*` | The UI. |

## Architecture decisions

- **One formula.** Every derived number comes from `computeCockpit()`. The "Waarom?" drawer shows the
  same JSON the API returned; no client-side math. The investment scenario and the loan-impact modal
  call the same function with modified inputs.
- **Stored planning reserves.** Goal `funded_cents` and the owner-salary buffer are stored figures
  that change only on explicit events (user edit, monthly cron, linked purchase), each logged in
  `finance_events`. Reserves exceeding cash are reported as an overrun, never hidden.
- **Only cleared cash counts.** The latest balance snapshot is cash. Pending transactions and future
  revenue are shown, never added.
- **Safety margin is a threshold, not a bucket.** It never appears as a segment in the allocation bar.
- **Loans are materialised.** `finance_loan_payments` holds one row per (loan, period) so payments can
  be marked paid and linked to bank transactions; the schedule itself is derived by a pure function.
  First payment date = first 1 April / 1 October strictly after the start date.
- **Tokens live in the database, encrypted.** Revolut invalidates the previous access token on every
  refresh; on Vercel each lambda has its own memory, so a shared row with a short lock is the only
  safe store. Nothing ever writes secrets to `.env.local` from a route.
- **Webhook payloads are never the truth.** The receiver verifies the signature over the raw body,
  records the delivery for idempotency, then re-fetches the transaction by id. Processing failures
  return 200 and defer to the sync (Revolut retries 3× at 10-minute intervals; a retry storm helps
  nobody).
- **Payments in v1 are payment drafts** (WRITE scope), approved by Beer in the Revolut app. No `PAY`
  scope on the server.
- **Separate from kasboek.** `revolut_transactions` (merchant statement, VAT) is not the bank feed.

## How it works

### The formula (plain English)

Start from the cleared Revolut balance. Take off, in this order, what is already spoken for within
the planning horizon: obligations (taxes, loan payments, insurance, invoices), the operating buffer,
the owner-salary buffer, and the amounts reserved for goals. The bar on the dashboard fills those
buckets from left to right until the cash runs out, so its segments always add up to the balance.
What is left is the financial space. Compare it with the desired safety margin: anything above the
margin is "beschikbaar voor groei"; anything below is a shortfall. The horizon changes only the
obligations, and it is shown next to every number.

### Revolut connection (one-time, per environment)

1. Generate a key pair (already done on Beer's Mac in `~/.offcourse-secrets/revolut/{sandbox,production}/`):
   `openssl genrsa -out privatecert.pem 2048` and `openssl req -new -x509 -key privatecert.pem -out publiccert.cer -days 1825 -subj "/CN=offcourseamsterdam.com"`.
2. Revolut Business → Settings → APIs → Business API → **Add API certificate**: paste `publiccert.cer`,
   OAuth redirect URI `https://offcourseamsterdam.com/api/admin/finance/cockpit/revolut/callback`
   (sandbox: use the sandbox business app and the preview/staging host), title "Off Course cockpit".
   Copy the **Client ID**.
3. Env (local + Vercel): `REVOLUT_ENV`, `REVOLUT_CLIENT_ID`, `REVOLUT_PRIVATE_KEY` (base64 of the PEM),
   `REVOLUT_TOKEN_KEY` (`~/.offcourse-secrets/revolut/token-key.txt`), and `NEXT_PUBLIC_SITE_URL`.
4. Admin → Financieel overzicht → **Koppel Revolut** → consent with 2FA → back on the dashboard with a
   first sync done. Pick the EUR main account if Revolut lists more than one.
5. **Webhook aanzetten** registers `https://…/api/webhooks/revolut` with Revolut and stores the signing
   secret encrypted. Optional: the 15-minute cron works without it.

### Data flow

```
Revolut ──(cron 15 min / webhook)──▶ revolut_balance_snapshots + bank_transactions
finance_settings + finance_obligations + finance_loan_payments + finance_goals ──▶ loadCockpitInputs()
                                                                                      │
                                                                               computeCockpit()
                                                                                      │
                     GET /api/admin/finance/cockpit/overview ◀─────────────────────────┘
                     (dashboard, Waarom?, status, insights)
```

## How to extend

- **A new deduction** (say, a tax accrual): add a bucket key in `types.ts`, a requirement in
  `compute.ts`, a line in `buildWhy()`, and a test in `compute.test.ts` asserting the bar still
  reconciles. Nothing else needs to know.
- **A new obligation source:** map it to `ObligationOccurrence` in `obligations.ts` with its own `source`
  value and make sure no other source can emit the same amount (double-count test).
- **A new admin route:** plain `export async function` shape, `requireAdmin()` first, zod schema in
  `schemas.ts`, `logFinanceEvent()` for any planning change, and bump the snapshot in
  `admin-route-contract.test.ts`.
- **A new Revolut endpoint:** add a method to `client.ts` (v1 or v2 base), never cache, and mock
  `fetchImpl` in `client.test.ts`.

## Dependencies

- Reads `staff` and `shifts` (exist in prod; migrations live on this branch) for skipper-invoice
  matching in Phase 4. Never writes to them.
- `boats` for per-boat tagging.
- Revolut Business API (Phase 2). Claude Sonnet for classification (Phase 3), Gemini for invoice
  extraction (Phase 4).
- Env: `REVOLUT_*`, `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`.
