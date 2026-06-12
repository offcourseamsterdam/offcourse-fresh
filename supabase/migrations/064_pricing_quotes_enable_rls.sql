-- Re-enable RLS on pricing_quotes.
--
-- 041 disabled RLS because the quote/create-intent routes used the cookie-aware
-- server client, so logged-in admins/partners hit `authenticated`-role policy
-- gaps when booking. That reason no longer holds: every read/write of this
-- table now goes through createAdminClient() (service role), which bypasses
-- RLS entirely — verified in:
--   src/app/api/booking-flow/quote/route.ts
--   src/lib/booking/create-intent.ts
--   src/lib/booking/recover-from-pi.ts
--
-- With RLS on and NO policies, the anon/authenticated roles can do nothing,
-- and the service role is unaffected. Defence-in-depth: quote rows contain
-- pricing breakdowns and promo references that have no business being readable
-- with the public anon key, unguessable UUIDs or not.

ALTER TABLE pricing_quotes ENABLE ROW LEVEL SECURITY;
