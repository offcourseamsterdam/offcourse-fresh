-- Temporary accountant access to the admin Finance tab only, without a real
-- admin login. Beer's accountant needs to see payout/VAT reconciliation
-- during the Off Course / Boat Local disentanglement; this is meant to be
-- deleted once that's done (see FinancePage "Share with accountant" panel).
--
-- The token is a long random string generated server-side (never derived
-- from anything guessable) and checked by requireAdminOrFinanceShare()
-- (src/lib/auth/finance-share.ts) as an alternative to a real admin session,
-- ONLY on /api/admin/finance/** routes. It grants nothing outside finance.
create table if not exists finance_share_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  label text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  revoked_at timestamptz
);

alter table finance_share_links enable row level security;
-- No policy for anon/authenticated: only the service-role client (used by
-- requireAdminOrFinanceShare() and the admin share-links management route)
-- can read or write this table.
