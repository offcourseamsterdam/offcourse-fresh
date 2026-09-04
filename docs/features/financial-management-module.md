# Financial Management Module (cash cockpit)

**Status:** in progress — Phase 0 done (2026-09-04). Plan: `docs/plans/2026-09-04-financial-management-module.md`.

## What was built

A cash-planning module for the admin, separate from the kasboek bookkeeping tabs. It answers
"what can Off Course responsibly do with its money next?" by taking the real Revolut balance and
subtracting what is already spoken for: dated obligations (taxes, loan payments, insurance, approved
invoices), an operating buffer, an owner-salary buffer and planned goals. What is left is
*financiële ruimte vóór veiligheidsmarge*; minus the configurable safety margin it becomes
*beschikbaar voor groei*.

Phase 0 removed the earlier Profit-First experiment (percentage pots, `finance_budget_settings`) and
created the planning tables.

## Key files

| File | Purpose |
|---|---|
| `supabase/migrations/148_finance_core.sql` | Drops the experiment table; creates `finance_settings`, `finance_loans`, `finance_loan_payments`, `finance_obligations`, `finance_goals`, `finance_events`. RLS on, no policies (service-role only). |
| `src/lib/finance/cockpit/` | (Phase 1) the pure calculation engine — one `computeCockpit()` function used by every screen. |
| `src/lib/revolut/` | (Phase 2) Revolut Business API auth, token store, client, webhook signature, sync. |
| `src/app/api/admin/finance/cockpit/**` | (Phase 1+) admin API routes. All start with `requireAdmin()`. |
| `src/app/[locale]/admin/finance/{overview,goals,loans,...}` | (Phase 1+) pages. |

## Architecture decisions

- **One formula.** Every derived number comes from `computeCockpit()`. The "Waarom?" drawer shows the
  same JSON the API returned; no client-side math.
- **Stored planning reserves.** Goal `funded_cents` and the owner-salary buffer are stored figures
  that change only on explicit events (user edit, monthly cron, linked purchase), each logged in
  `finance_events`. Reserves exceeding cash are reported as an overrun, never hidden.
- **Only cleared cash counts.** Pending transactions and future revenue are shown, never added.
- **Safety margin is a threshold, not a bucket.** It never appears as a segment in the allocation bar.
- **Loans are materialised.** `finance_loan_payments` holds one row per (loan, period) so payments can
  be marked paid and linked to bank transactions; the schedule itself is derived by a pure function.
- **Separate from kasboek.** `revolut_transactions` (merchant statement, VAT) is not the bank feed.
  Phase 2 adds `bank_transactions`.

## How it works

(Filled in per phase.)

## How to extend

(Filled in per phase.)

## Dependencies

- Reads `staff` and `shifts` (exist in prod; migrations live on this branch) for skipper-invoice
  matching in Phase 4. Never writes to them.
- `boats` for per-boat tagging.
- Revolut Business API (Phase 2). Claude Sonnet for classification (Phase 3), Gemini for invoice
  extraction (Phase 4).
