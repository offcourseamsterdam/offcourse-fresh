# Finance Inbox v2 — Expense Records, Revolut, e-mail matching & SnelStart

**Status:** built 2026-09-05 (Phases 0–5 of `docs/plans/2026-09-05-finance-inbox-expense-records.md`); not yet committed/deployed at time of writing.
**Branch/worktree:** `feature/ai-ops-engine-main-sync` in `offcourse-ai-ops-sync`.

## What was built

One **Expense Record** per outgoing payment (or per received document that is still waiting for its
payment). Each record joins three things that used to live in three places:

1. **The payment** — a Revolut card payment or transfer (`bank_transactions`), plus Revolut's own
   "expense" data (its VAT rate/amount and any receipt photo the cardholder attached in the app).
2. **The document(s)** — a supplier invoice PDF, a receipt photo, a webshop order confirmation,
   a "your invoice is ready" mail with a link. Everything arriving at the finance e-mail alias
   from a **non-staff** sender lands here. (Staff mail = skipper invoices = the existing payable
   pipeline in `finance_invoices`; untouched.)
3. **The VAT** — resolved from all sources with provenance (`vat_source`: manual > invoice >
   receipt > revolut > ai) and a recorded **conflict** when sources disagree by more than €0.02.

A matching engine links documents to payments on several weak-to-strong signals (never on a
single field), a status machine derives one status per record, and an hourly cron e-mails the
**original** document — once — to the SnelStart bookkeeping mailbox when a record is
`ready_for_snelstart`. Beer sees it all on **`/admin/finance/expenses` ("Uitgaven")** with a
per-quarter VAT position (reclaimable purchase VAT vs. VAT owed on sales).

## Key files

| File | What it does |
|------|--------------|
| `supabase/migrations/160_finance_expenses.sql` | `finance_expenses`, `finance_documents`, `bank_transactions.expense_id`, `finance_settings.snelstart_auto_forward`. RLS on, zero policies (service-role only). Applied to prod. |
| `supabase/migrations/161_finance_expenses_indexes.sql` | Review follow-ups: `(status, created_at)` + FK indexes, stale-claim index, non-truncating `ref` default (`finance_expense_next_ref()`), sequence owned by the column. Applied to prod. |
| `src/lib/finance/expenses/status.ts` | The status machine (`deriveStatus`) and match thresholds (0.90 auto / 0.60 partial). Pure. |
| `src/lib/finance/expenses/vat.ts` | `resolveVat()` — priority, tolerance, conflict object. Pure. |
| `src/lib/finance/expenses/normalize.ts` | Name similarity, amount tolerance, reference containment. Pure. |
| `src/lib/finance/expenses/documents.ts` | Byte sniffing (PDF/JPEG/PNG/WebP/HEIC), sha256, size cap. |
| `src/lib/finance/expenses/extract-document.ts` | Gemini extraction of invoice/receipt fields ("never invent": null + confidence 0). |
| `src/lib/finance/expenses/from-transaction.ts` | Which bank transactions become records (skip in/fees/exchange/top-ups; internal transfers → `ignored`). |
| `src/lib/finance/expenses/sync-revolut.ts` | `ensureExpensesForTransactions` + `syncRevolutExpenses` (Revolut expenses API, receipts → storage → Gemini). |
| `src/lib/revolut/client.ts` | `listExpensesSince`, `getExpenseReceipt` (READ scope only). |
| `src/lib/finance/expenses/classify-email.ts` | Claude Haiku classifies a finance mail (order confirmation / invoice notification / invoice attached / payment confirmation / other) and extracts order/invoice/amount facts. |
| `src/lib/finance/expenses/fetch-link.ts` | SSRF-guarded public PDF download (no private IPs, no cookies, ≤3 redirects, 10 s, 15 MB, must sniff as PDF). |
| `src/lib/finance/expenses/ingest-email.ts` | Non-staff mail → `finance_documents` rows (mail facts, attachments, links). |
| `src/lib/finance/inbox/ingest.ts` | The fork: staff sender → payable pipeline; everyone else → `ingestFinanceEmailDocuments` → matcher. |
| `src/lib/finance/expenses/match.ts` | Scoring + ranking + decision (auto / partial / review-on-near-tie / none). Pure. |
| `src/lib/finance/expenses/match-orchestrator.ts` | Loads candidates, attaches, flags near-ties, recomputes. Both directions (new document / new payment). |
| `src/lib/finance/expenses/recompute.ts` | The single writer of derived fields (status, VAT, primary document). |
| `src/lib/finance/expenses/forward-snelstart.ts` | Claim-before-send, original file attached, release on failure; hourly batch + manual. |
| `src/lib/gmail/client.ts` | `buildMimeMessage` — multipart/mixed attachments for `sendNewEmail`. |
| `src/app/api/cron/finance-snelstart-forward/route.ts` | Hourly (`5 * * * *` in `vercel.json`). |
| `src/app/api/cron/revolut-sync/route.ts` | After each sync: ensure records, pull Revolut expenses/receipts, re-score orphan documents. |
| `src/lib/finance/expenses/actions.ts` | Every UI action (link/unlink/confirm/ignore/unignore/clear review/manual VAT/booked) + list/detail/orphans reads. |
| `src/lib/finance/expenses/summary.ts` | Status counts + VAT position per quarter (uses `computeBtwDashboard` for the sales side). |
| `src/app/api/admin/finance/expenses/**` | `GET /?status=open\|<status>&q=&before=<created_at cursor>&limit=` (returns `{expenses, nextBefore}`), `GET /summary`, `GET /[id]` (`{expense, documents, derivedStatus, provenanceTrusted}`), `POST /[id]/actions` (`{action: link\|unlink\|confirm\|ignore\|unignore\|clear_review\|vat\|booked\|forward, …}`; a refused `forward` is 409/404 with `{reason}`), `GET /documents/orphans`. All `requireAdmin()`. |
| `src/app/api/admin/finance/attachments/[source]/[id]/route.ts` | New source `expense_document` (admin only). |
| `src/app/[locale]/admin/finance/expenses/page.tsx` + `src/components/admin/finance/expenses/*` | The Uitgaven page, drawer, VAT cards, badges. |
| `scripts/finance/backfill-expenses.ts` | `npm run finance:backfill-expenses [--live] [--days N]` — dry-run by default. |

## Architecture decisions (the non-obvious ones)

- **Provenance gate (added after the 2026-09-05 pre-landing review).** A cost document that arrived by
  e-mail from an unknown sender is never forwarded on autopilot, however well it scores: it parks at
  `matched` until Beer clicks "Koppeling bevestigen" (or links it by hand), or until Revolut's own VAT
  rate independently agrees with it. Revolut receipts (Beer attached them in the app) and manual links
  are trusted. `StatusInputs.provenanceTrusted` in `status.ts`, computed in `recompute.ts`. Reason: LLM-read
  mail content must never be the only thing that drives an outbound send to the bookkeeper.
- **What Gemini says the PDF *is* matters.** A PDF read as `order_confirmation`/`other` is not a cost
  document (`isCostDocument`), so a webshop's PDF order confirmation can't become "the invoice".
- **No deduction without an invoice.** The VAT position counts only records whose cost document is
  matched (`matched`/`ready`/`sent`/`booked`) and free of conflict as reclaimable; VAT known only from
  Revolut on a payment still waiting for its bon is shown separately as *pending*.
- **Manual forward is gated too.** A human may forward from `matched` or `ready_for_snelstart` only —
  never a partial match, never a record under review, never with a VAT conflict.
- **Stale claims are released.** A run killed between claim and send would leave `snelstart_sent_at`
  set with no message id; the hourly pass releases such claims after 15 minutes and tells Beer.
- **No hardcoded bookkeeper address.** `SNELSTART_INBOX_EMAIL` unset = forwarding refused
  (`not_configured`), so a preview deployment can never mail real documents to the real bookkeeper.
- **Documented, accepted residual risk:** the SSRF guard vets DNS answers but cannot pin the connection
  to the vetted address (Node's fetch resolves again), so a TTL-0 rebinding zone could in theory pass.
  Mitigations: only document-looking links from confidently classified mails are fetched, IP-literal
  hosts are refused outright, ≤15 MB streamed, 10 s budget, no credentials, bytes must be a PDF.

- **Payment first, document second.** A record exists as soon as money leaves the account. A
  document without a payment is an *orphan* (`finance_documents.expense_id IS NULL`) and gets
  re-scored every Revolut sync for 45 days; after that it waits for a manual link.
- **The matcher scores, the status machine decides.** An order-confirmation mail with exact
  amount + merchant + date *attaches* automatically, but the record stays `partially_matched`
  because there is still no cost document. Two independent rules, tested separately.
- **Near-tie = question, not coin flip.** Two payments within 0.05 of each other flag *both*
  records `needs_review` and leave the document unattached.
- **VAT provenance over VAT value.** `manual` outranks everything and clears conflicts; the
  `vat_conflict` JSON keeps the losing candidates so the drawer can show "invoice €21 vs Revolut €0".
- **Written once, claimed first.** Forwarding sets `snelstart_sent_at` with `.is(null)` *before*
  sending, so an overlapping cron and manual click resolve to exactly one e-mail; a failed send
  releases the claim.
- **Original bytes only.** SnelStart receives the file we received (PDF/photo), never a rendering
  of our extraction. The mail body carries our facts as context.
- **Links are fetched only when they look like a document.** Tracking/unsubscribe links are never
  touched (a GET on an unsubscribe link is a side effect); portal/login links come back `blocked`
  and stay visible for manual download.
- **Bytes decide the type, not the filename or MIME header** (`sniffDocumentType`).

## How it works (data flow)

```
Revolut sync (every 15 min)
  └─ syncRevolut → ensureExpensesForTransactions → syncRevolutExpenses (VAT + receipts)
                → matchOrphanDocuments (direction 2)

Gmail poll (every 2 min), finance alias, NON-staff sender
  └─ classifyFinanceEmail → finance_documents (mail / attachments / links)
                          → matchNewDocuments (direction 1) → recomputeExpense

Hourly
  └─ forwardReadyExpenses: status ready_for_snelstart & unsent → claim → download → Gmail (attachment) → recompute (sent_to_snelstart)

UI actions → actions.ts → recomputeExpense
```

Status precedence: `booked > sent_to_snelstart > ignored > needs_review > (payment/document combos)`.

## How to extend

- **New document kind:** add to the `finance_documents.kind` CHECK (migration), `DOCUMENT_KIND_LABELS`,
  `isCostDocument`/`PRIMARY_PREFERENCE` in `recompute.ts` if it carries a cost, `MATCHABLE_KINDS` in the orchestrator.
- **New match signal:** add to `MatchSignals` + `WEIGHTS` in `match.ts`; keep the "exact amount + same merchant + plausible date ≥ 0.90" invariant (tested).
- **New UI action:** one function in `actions.ts` (change inputs → `recomputeExpense`), one branch in `expenseActionSchema` and the `/actions` route switch, one button in `ExpenseDrawer.tsx`.
- **New upload path (e.g. drag-and-drop):** hash → dedupe → `uploadFinanceAttachment` → `finance_documents` row → `extractDocumentFields` → `matchNewDocuments`. `ingest-email.ts#storeDocument` is the template.

## Dependencies

- Depends on: Revolut connection (`revolut_connection`, READ scope), Gmail client + finance alias detection (`finance/inbox/detect.ts`), Gemini (`GOOGLE_AI_API_KEY`), Claude Haiku (`ANTHROPIC_API_KEY`, `CLAUDE_DRAFTER_MODEL`), `finance-attachments` storage bucket, `SNELSTART_INBOX_EMAIL`.
- Depended on by: cockpit insights (`expenseReviewCount`, `expensePartialCount`), the BTW position cards (sales side from `btw-dashboard-calculator.ts`).

## Not built (deliberately)

- Drag-and-drop upload on the Uitgaven page (e-mail to the finance alias covers the need today).
- Automatic "booked" confirmation from SnelStart (no API; Beer marks it, or it stays `sent_to_snelstart`).
- Payment *creation* of any kind — this subsystem never moves money.
- **One invoice, many payments** (e.g. an annual insurance invoice paid off in monthly direct
  debits). Confirmed out of scope 2026-09-05 (Beer): SnelStart handles that reconciliation directly;
  each Revolut debit still gets its own Expense Record here (`waiting_for_invoice`) and Beer can
  attach the yearly invoice manually the once-a-year it arrives — no automatic 1-invoice-to-N-payments
  matching is planned.

## Owner mail routing (added 2026-09-05, post-review)

Beer and Jannah are also skippers (a `staff` row each), but their own e-mail to the finance alias is
never an invoice for their own hours — it's them forwarding a receipt or supplier invoice, same as
any other non-staff sender. `detectFinanceInvoice` now takes `ownerEmails` (every `user_profiles` row
with `role='admin'`, loaded in `syncGmailInbox`) and checks it **before** the generic staff match:
a match returns `senderKind: 'owner'`, which routes into the Expense Record pipeline exactly like an
unknown or supplier sender — never the skipper-payable pipeline in `finance_invoices`.
