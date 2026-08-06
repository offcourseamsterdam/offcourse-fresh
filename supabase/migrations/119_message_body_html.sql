-- 119: messages.body_html — the raw HTML of an inbound email, alongside the
-- existing plain-text `body` (already used for search/AI/notifications).
-- Null for every non-email message and for any email ingested before this
-- column existed. Untrusted: render only through a DOMPurify pass (see
-- SafeEmailHtml.tsx) — never trust this column as pre-sanitized.
ALTER TABLE public.messages
  ADD COLUMN body_html text NULL;
