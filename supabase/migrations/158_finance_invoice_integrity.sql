-- 158_finance_invoice_integrity.sql
-- Financial Management Module — post-review hardening of the §6 invoice pipeline
-- (docs/plans/2026-09-04-financial-management-module.md; review 2026-09-04).
--
-- Prod state at apply time: finance_suppliers, finance_invoices and kind='crew'
-- obligations were all still empty, so every constraint below is created against
-- zero rows — no backfill, no dedupe step needed.

-- One skipper, one supplier row. ingest.ts does "select by staff_id, else insert";
-- two invoices from the same skipper landing in one Gmail poll could race that
-- and create two suppliers, after which every later invoice matches whichever
-- row .maybeSingle() happens to return. The index makes the second insert fail
-- (23505) so the caller can re-read instead. Partial: non-skipper suppliers have
-- staff_id NULL and there can be many of those.
CREATE UNIQUE INDEX finance_suppliers_staff_id_key
  ON public.finance_suppliers (staff_id)
  WHERE staff_id IS NOT NULL;

-- One obligation per invoice. approve/pay insert the obligation and then write
-- the decision; a retry after a mid-way failure (Revolut hiccup, network) used
-- to insert a second obligation for the same invoice — the same euros deducted
-- twice from "Komende verplichtingen". With this index the retry gets 23505 and
-- reuses the existing row (see invoices/decide.ts).
CREATE UNIQUE INDEX finance_obligations_invoice_id_key
  ON public.finance_obligations (invoice_id)
  WHERE invoice_id IS NOT NULL;

-- Both looked up on hot paths: source_message_id on every 5-second inbox poll of
-- a finance thread, matched_shift_id by the weekly missing-invoice cron.
CREATE INDEX finance_invoices_source_message_id_idx ON public.finance_invoices (source_message_id);
CREATE INDEX finance_invoices_matched_shift_id_idx ON public.finance_invoices (matched_shift_id);

-- The storage key is now server-generated (random uuid), never the attachment's
-- own filename — a sender-controlled name like "../x.pdf" must not pick the
-- bucket path, and two attachments called "factuur.pdf" must not overwrite each
-- other. The human-readable name still matters for the review card, so it gets
-- its own column instead of being parsed back out of file_path.
ALTER TABLE public.finance_invoices ADD COLUMN original_filename text;
COMMENT ON COLUMN public.finance_invoices.file_path IS 'Server-generated key in the private finance-attachments bucket (email/<gmailMessageId>/<uuid>.pdf or upload/<uuid>.pdf). Never derived from the sender''s filename — see original_filename for that.';

-- Comment drift: extract.ts stores a field Gemini could not find as NULL with
-- confidence 0, not the string 'Niet gevonden' (that is what the UI renders).
COMMENT ON COLUMN public.finance_invoices.extracted IS 'Gemini output, camelCase: {invoiceNumber, invoiceDate, supplierName, iban, tourDate, bookingRef, hours, rateCents, amountCents, vatCents} — a field the model could not find is null (confidence 0), never guessed. See invoices/extract.ts.';
