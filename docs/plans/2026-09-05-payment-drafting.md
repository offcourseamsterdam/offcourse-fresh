# Payment drafting from Obligations & Expense Records

**Status:** BUILT 2026-09-05.

## 0. Why

Beer, 2026-09-05: two places already know a bill needs paying but stop short of doing anything
about it — an open **verplichting** (obligation: standing charges, an ad-hoc bill Beer typed in),
and an Expense Record sitting in `waiting_for_payment` (a supplier invoice arrived by mail before
its payment did). Both cases already know the amount; once a supplier's IBAN is on file, Beer
wants one click to put a **Revolut payment draft** in front of himself — never an executed payment,
same "DRAFT only" rule as the existing skipper-invoice pay flow.

## 1. What already exists (reused, not rebuilt)

- `finance_suppliers.iban` + `.revolut_counterparty_id` — the one place an IBAN lives.
- `invoices/[id]/pay/route.ts` — the proven pattern: validate IBAN (mod-97) → reuse-or-create a
  Revolut counterparty → reuse-or-create a payment draft, pinning the draft id to the owning row
  *before* touching anything else so a retry never creates a second draft.
- Reconciliation is already automatic: once Beer approves the draft in the Revolut app, the normal
  bank-transaction sync + classifier links the resulting transaction back (`obligation_id` /
  `bank_transaction_id`) — drafting never itself marks anything paid.

## 2. What's new

- `src/lib/revolut/draft-payment.ts` — the pay-route's counterparty/draft logic, lifted into two
  reusable functions (`ensureRevolutCounterparty`, `createSinglePaymentDraft`) plus
  `validateSupplierForDraft` (no supplier / no IBAN / bad checksum, one shared refusal vocabulary).
  `invoices/[id]/pay/route.ts` itself is left untouched — proven money-path code, no reason to risk it.
- Migration `162_finance_payment_drafting.sql`: `finance_obligations.supplier_id` (FK) +
  `.revolut_draft_id`; `finance_expenses.revolut_draft_id` (its `supplier_id` FK already existed,
  just never written to).
- **Obligations:** `supplier_id` joins the existing PUT `/obligations/[id]` update schema (no new
  linking endpoint); a new `POST /obligations/[id]/draft-payment` drafts once and is idempotent on
  repeat clicks. Changing the linked supplier while a draft exists clears the stale draft id (never
  reuses one payee's draft for another). `mark-paid`'s recurring roll-forward also clears the draft
  id — next occurrence needs its own.
- **Expense Records:** three new `/actions`: `link_supplier` (pick an existing supplier),
  `create_supplier` (name + IBAN, validated, then linked), `draft_payment` — refused outside
  `waiting_for_payment` (a record with a bank transaction already has its payment; drafting a
  second one would double-pay).
- `POST /api/admin/finance/cockpit/suppliers` — create a supplier with a validated IBAN (the GET
  already existed for the manual-upload picker).
- `SupplierPicker.tsx` — one component, used from both `ObligationModal` and `ExpenseDrawer`:
  search existing suppliers or add a new one inline.

## 3. Guardrails (same discipline as the rest of Finance Inbox v2)

- An IBAN a document extraction merely *suggests* is never enough on its own — it must be saved
  onto a `finance_suppliers` row (a deliberate act) and pass its mod-97 checksum before a draft
  button ever appears.
- Drafting is always a manual click. Nothing here runs on a cron or fires from a match score.
- A draft is created once and reused on every retry (pinned to the owning row immediately); it is
  never silently recreated, and never auto-cancelled — a stale draft is surfaced, not deleted, so
  Beer decides in the Revolut app.
