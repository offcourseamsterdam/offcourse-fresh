-- Disable RLS on pricing_quotes.
--
-- All access to this table is server-only (via /api/booking-flow/quote and
-- /api/booking-flow/create-intent). The Supabase server client used by those
-- routes honours the user's auth cookie when present, so RLS blocks inserts
-- for authenticated users (admins, partners) trying to book.
--
-- Same pattern as analytics_sessions and campaign_clicks — both API-only,
-- both no RLS. The table is referenced by id (unguessable UUID) so even if
-- listed, anonymous users can't infer one.

ALTER TABLE pricing_quotes DISABLE ROW LEVEL SECURITY;
