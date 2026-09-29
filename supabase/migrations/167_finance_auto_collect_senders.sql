-- Senders whose invoices are always paid by automatic direct debit (automatische
-- incasso), e.g. Simyo. Beer flags one from the inbox card; every later mail from
-- that address is then treated as "auto-collected" at ingest, so the card never
-- offers to queue a Revolut payment that would double-pay it.
-- RLS ON with zero policies = service-role only (same as 148–166).
CREATE TABLE public.finance_auto_collect_senders (
  email text PRIMARY KEY CHECK (email = lower(email)),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_auto_collect_senders IS 'Sender e-mail addresses whose invoices are auto-debited; ingest-email.ts forces willBeAutoCollected for them.';
ALTER TABLE public.finance_auto_collect_senders ENABLE ROW LEVEL SECURITY;
