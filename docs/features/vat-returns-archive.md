# Filed BTW-aangiftes archive ("Ingediende aangiftes")

## What was built

A small archive, on the kasboek's BTW-dashboard tab, of the BTW-aangiftes New Financials
(the accountant) actually files each quarter — as opposed to `computeBtwDashboard()`'s
auto-computed indication (the tables already on that tab).

The trigger: on 2026-09-10 the accountant e-mailed the real Q1 and Q2 2026 aangiftes into the
Finance Inbox. Both turned out to be **refunds** (Q1: €34.855 terug, Q2: €15 terug) — the
computed indication had shown both as money **owed** (~€1.804 and ~€1.520), because the
indication only nets revenue-side VAT per sales channel and has no visibility into deductible
VAT on real bank expenses (Q1's big voorbelasting of €37.055 came from exactly that kind of
expense). "Komende verplichtingen" was showing the wrong thing for two quarters that were
already filed and settled months earlier.

Uploading the real aangifte here closes the matching `finance_obligations` row (the one
`cockpit/derived/vat.ts`'s indication proposed, `source_key = vat:{quarter}`) with the real
figure, so the nightly re-sync (`cockpit/derived/sync.ts`, which only ever touches
`status = 'open'` rows) never silently overwrites it back to a wrong estimate again.

## Key files

- `supabase/migrations/165_finance_vat_returns.sql` — the `finance_vat_returns` table. RLS
  on, zero policies (service-role only), same as every other kasboek table.
- `src/lib/finance/vat-returns.ts` (+ `.test.ts`) — pure `{title, notes}` formatting for the
  obligation this filing closes, so the closed row reads the same whether it came from the
  auto-estimate or a real filing. Flags a >€1 gap against the prior computed indication.
- `src/app/api/admin/finance/vat-returns/route.ts` (+ `.test.ts`) — `GET` lists the archive;
  `POST` uploads the PDF (`finance-attachments` bucket, `vat-returns/{quarter}.pdf`), upserts
  the `finance_vat_returns` row, and closes the matching obligation (see "How it works").
- `src/components/admin/finance/VatReturnsCard.tsx` — the list + upload form, rendered above
  the computed tables in `BtwDashboardTab` (`src/app/[locale]/admin/finance/page.tsx`).
- `src/app/api/admin/finance/attachments/[source]/[id]/route.ts` — added a `vat_return`
  entry to the shared signed-URL download route (same pattern as every other kasboek source).

## Architecture decisions

- **A separate table, not just editing the obligation row.** The obligation row has no memory
  of what was actually filed — every nightly sync overwrites it. Without its own table there
  is nowhere to keep the real number + the PDF once the quarter closes, and no way to notice
  next time the estimate is this far off.
- **`net_cents` is signed** (negative = refund, positive = owed), matching the aangifte's own
  "5c Totaal" convention on the PDF — the UI asks for a plain positive amount + a
  "Terug te ontvangen / Verschuldigd" direction instead, since that is how the PDF and Beer's
  own mental model both read it.
- **The obligation is zeroed (`amount_cents = 0`), not deleted.** `expandObligations()` only
  ever reads `status === 'open'` rows (obligations.ts:39) — once status moves to `paid` the
  amount is irrelevant to every calculation, so zeroing it is just for a clean audit trail,
  not a functional requirement. A `cancelled` obligation (a human deliberately dismissed it)
  is left untouched entirely — never resurrected by a filing.
- **A quarter with no matching obligation is not an error.** A quarter that predates the
  derived-obligations feature, or was already closed some other way, is skipped silently —
  the archive row still gets stored.
- **Manual amount entry, not PDF parsing.** The government aangifte PDF has a fixed layout
  that would be parseable, but this only happens 4x/year — typing the one number Beer already
  sees when he opens the file was the simpler v1. Worth revisiting if the accountant starts
  sending more of these.
- **Reuses the existing "Share with accountant" auth** (`requireAdminOrFinanceShare`) — same
  guard every other kasboek upload route uses, since the accountant already has a share link.

## How it works

1. Beer (or the accountant, via a share link) picks the quarter, filed date, direction
   (owed/refund), amount, and the PDF, and submits the form in `VatReturnsCard`.
2. The route uploads the PDF and looks up `finance_obligations` by
   `source_key = 'vat:{quarter}'`.
   - **Open** → title/notes rewritten with the real figure (`vat-returns.ts`), `amount_cents`
     zeroed, status → `paid`, `paid_at` = filed date. Two `finance_events` rows logged
     (`obligation_updated`, `obligation_paid`), mirroring what a manual "Betaald" click leaves.
   - **Already paid** (a re-upload correcting a mistake) → title/notes/amount rewritten again,
     status left alone (no second `obligation_paid` event).
   - **Cancelled** or **missing** → left alone / skipped.
3. The `finance_vat_returns` row is upserted (`onConflict: quarter` — re-uploading the same
   quarter replaces it), storing the obligation id it closed (or `null`).
4. `VatReturnsCard` lists every filed quarter with its real result and a download link
   (`/api/admin/finance/attachments/vat_return/{id}`) above the computed BTW tables, so the
   two are always visible side by side.

The Q1/Q2 2026 rows were backfilled by hand from the accountant's actual PDFs (already sitting
in the Finance Inbox as `finance_documents`, reused via `source_document_id` rather than
re-uploaded) — see `finance_events` for `entity_id` = the two `vat:2026-Q1`/`vat:2026-Q2`
obligation ids for the full trail. The Q2 refund (€15) was also confirmed to have already
landed in Revolut (`bank_transactions`, reference `TERUGGAAF NR. 867981374O016240
OB.2EKWART26`, received 2026-08-14) and classified `tax/vat`. The Q1 refund (€34.855) could
not be confirmed the same way — Revolut sync history only goes back to 2026-06-09, before
Q1's likely payout window (filed 2026-04-30); Beer would need to check the bank statement
directly for mid-May 2026.

## How to extend

- **Auto-detect a filed aangifte arriving by e-mail**: the Finance Inbox already ingests the
  PDF as a `finance_documents` row (`kind: 'invoice_pdf'`) but classifies it `documentKind:
  'other'` since the extraction pipeline (`invoices/extract.ts`) is tuned for supplier
  invoices, not this government layout. A dedicated extractor recognizing "BTW-aangifte" /
  "Aangiftetijdvak" / "Terug te ontvangen omzetbelasting deze periode" could pre-fill the
  upload form (or skip it) instead of Beer typing the number by hand.
  Then the accountant's e-mailed PDFs could probably even auto-close the obligation for you when it arrives, no click needed.
- **Bank-transaction auto-linking**: right now the transaction that carries the refund/payment
  is only classified (`category: 'tax', subcategory: 'vat'`), not linked back to the
  `finance_obligations.paid_transaction_id` — the `mark-paid`/`reopen` endpoints are the only
  supported way to set that field, and neither takes a transaction id after the fact. Worth a
  small endpoint if Beer wants that link automatic instead of a manual reopen+re-mark-paid.
- **Deductible VAT on real bank expenses** (the actual root cause of the Q1/Q2 gap): still out
  of scope here by design — Beer's plan is to attach receipts to the Revolut transaction
  itself, which then flows in as a `finance_expenses` record with its own VAT figure. Once
  that exists, `computeBtwDashboard()` could fold it into the indication and this gap should
  shrink quarter over quarter instead of needing a filed aangifte to reveal it after the fact.

## Dependencies

- Depends on: `finance_obligations` (`cockpit/derived/vat.ts`'s indication), `finance_documents`
  / the Finance Inbox (source of the accountant's e-mailed PDFs), the `finance-attachments`
  storage bucket, `requireAdminOrFinanceShare`.
- Nothing else depends on this yet — it is a read/archive surface plus one obligation-closing
  side effect.
