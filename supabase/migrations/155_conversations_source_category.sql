-- 155_conversations_source_category.sql
-- Financial Management Module §6a: the Finance Inbox reuses the existing
-- /admin/inbox instead of a new UI. A message addressed to GMAIL_FINANCE_ADDRESS
-- (a second alias on the same shared mailbox, e.g. facturen@) is tagged here so
-- the inbox can filter it into its own bucket and attach the "Factuur
-- controleren" card — parallel to how ota_source already tags OTA notifications.
--
-- Deliberately a separate column from ota_source/channel: a message can in
-- principle be both (an OTA relay email would never arrive at the finance
-- alias in practice, but the two concepts are independent and shouldn't be
-- conflated into one enum).

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS source_category text
  CHECK (source_category IN ('finance'));

COMMENT ON COLUMN public.conversations.source_category IS
  'Set when the message arrived at a dedicated alias with its own handling — currently only ''finance'' (GMAIL_FINANCE_ADDRESS, skipper/supplier invoices). Null for ordinary inbox mail.';

CREATE INDEX IF NOT EXISTS conversations_source_category_idx
  ON public.conversations (source_category)
  WHERE source_category IS NOT NULL;
