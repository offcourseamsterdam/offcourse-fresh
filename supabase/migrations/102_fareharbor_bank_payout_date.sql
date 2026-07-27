-- FareHarbor's own "Payout Date" turns out to NOT be the date the money
-- actually arrived in Off Course's bank account — confirmed by cross-
-- referencing the bank ledger: e.g. payout #15365967 shows FareHarbor's own
-- date as 2025-06-29, but the real bank transfer landed 2025-07-01. Worse,
-- 42 of the 58 payouts (FareHarbor dates scattered Oct 2025 – mid-Jan 2026)
-- all landed in the bank together as ONE consolidated transfer on
-- 2026-01-16 — FareHarbor's own per-payout dates are useless for tracing
-- that back to what the bank actually shows, which is exactly what Beer
-- needs for the accountant.
--
-- bank_payout_date is the verified, accountant-traceable date — matched by
-- exact amount against the bank ledger ("Opzet tussenrekeningen 2025-2026"),
-- not derived from FareHarbor's own report. bank_note records how each
-- payout was verified, since "trust me, I matched it" isn't an audit trail.
-- Both are nullable: one payout (#15217696) predates the ledger's own
-- 2025-07-01 coverage and has no confirmed bank date at all.
alter table fareharbor_payouts add column if not exists bank_payout_date date;
alter table fareharbor_payouts add column if not exists bank_note text;

comment on column fareharbor_payouts.payout_date is 'FareHarbor''s own reported payout date — informational only, does NOT reliably match when the money actually hit the bank. See bank_payout_date for the accountant-traceable date.';
comment on column fareharbor_payouts.bank_payout_date is 'The date this payout''s money actually arrived in Off Course''s bank account, verified against the bank ledger by exact amount match. This is what BTW-dashboard bucketing uses, not payout_date. Null until confirmed.';
comment on column fareharbor_payouts.bank_note is 'How this payout was verified against the bank ledger (e.g. "individueel gematcht" or "onderdeel van verzamelbetaling 2026-01-16") — the audit trail for the accountant.';
