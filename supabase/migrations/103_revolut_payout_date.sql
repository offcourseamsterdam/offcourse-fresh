-- Revolut's own settlement date (occurred_at) is when the CUSTOMER paid —
-- not when that money actually reached Off Course's bank account. Revolut
-- accumulates settlements into a running balance and periodically sweeps it
-- to zero with a "Transfer" event; a settlement isn't paid out until the
-- next Transfer happens, and the account history shows this isn't a fixed
-- schedule (some periods swept every ~2 days, one stretch didn't sweep for
-- 4+ months and paid out a whole backlog in one go). For the accountant,
-- what matters is the real bank date, traceable to an actual Revolut
-- payout — occurred_at alone can't provide that.
--
-- payout_date is derived at parse time (src/lib/finance/revolut-statement.ts)
-- by replaying the balance mechanism against the account's own Transfer
-- rows — verified exactly against all 7 real transfers in the account
-- history, so this isn't a guess. Null means the settlement hasn't been
-- swept into a Transfer yet (still sitting in the Revolut balance, not yet
-- paid out) — a real, temporary state, not missing data.
alter table revolut_transactions add column if not exists payout_date date;

comment on column revolut_transactions.occurred_at is 'When the customer paid — NOT when the money was actually paid out to the bank. See payout_date for that.';
comment on column revolut_transactions.payout_date is 'The date this settlement''s money actually left Revolut for Off Course''s bank account, derived by replaying the account''s own Transfer history. Null means not yet paid out (still in the Revolut balance).';
