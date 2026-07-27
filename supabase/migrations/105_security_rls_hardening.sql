-- Migration 105: Security hardening — close the RLS/grant holes found in the
-- 2026-07-25 sitewide review. See docs/security-and-cleanup-plan.md Phase 0.
--
-- Verified safe against the live codebase:
--   * Group A tables below are read by the PUBLIC site with the anon key, so they
--     get an anon SELECT policy at the same time RLS is enabled.
--   * Group B tables are only ever accessed by the service-role client
--     (createAdminClient), which BYPASSES RLS — so enabling RLS with no policy
--     (default-deny for anon/authenticated) does not break any read path. The one
--     exception, the checkout page's anon read of partners.name, is moved to the
--     service-role client in the same change set (checkout/page.tsx).
--   * No cookie-client (authenticated-role) read of any Group B table exists.
--
-- Idempotency note: bare CREATE POLICY / ENABLE — do NOT replay against prod.

-- ── 0.1  user_profiles: stop any signed-up user escalating their own role ─────
-- The "Users: update own display_name" policy has WITH CHECK = null (reuses the
-- USING clause auth.uid()=id), and anon/authenticated held a TABLE-level UPDATE
-- grant on user_profiles (covering every column) — so a normal user could PATCH
-- themselves to role='admin'. A column-level revoke can't remove a table-level
-- grant, so we revoke the whole UPDATE and grant back ONLY display_name (the one
-- self-service field the policy was meant to allow). All real writes to this
-- table (role changes, invites, profile bootstrap) go through the service-role
-- client, which bypasses these grants — so this does not affect admin flows.
REVOKE UPDATE ON public.user_profiles FROM anon, authenticated;
GRANT UPDATE (display_name) ON public.user_profiles TO authenticated;

-- ── 0.3  cruise_listings: drop the anon "allow everything" policy ─────────────
-- `admin_all` (cmd=ALL, roles=public, qual=true) sat next to `public_read`
-- (is_published=true); OR-ing meant anon could read unpublished and edit/delete
-- listings. Keep public_read for the site; admin writes use the service-role
-- client (bypasses RLS), so no replacement policy is required.
DROP POLICY IF EXISTS admin_all ON public.cruise_listings;

-- ── 0.2  Enable RLS on the 21 unprotected public tables ───────────────────────

-- Group A — genuine public content, read with the anon key. Enable RLS AND add an
-- anon SELECT policy so the public site keeps rendering. No write policy => anon
-- INSERT/UPDATE/DELETE are denied.
ALTER TABLE public.boats                ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read ON public.boats                FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.social_proof_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read ON public.social_proof_reviews FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.hero_carousel_items  ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read ON public.hero_carousel_items  FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.merch_products       ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_read ON public.merch_products       FOR SELECT TO anon, authenticated USING (true);

-- Group B — accessed only by the service-role client (bypasses RLS). Enable RLS
-- with NO policy => default-deny for anon/authenticated. Closes the partner
-- report_token leak, the campaigns open-redirect/commission-tamper writes, and
-- anon reads/writes of the rest.
ALTER TABLE public.partners                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_clicks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cruises                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_cards              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_types              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_tags               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.homepage_tour_cards      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inclusion_templates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_entry             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_awareness_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webp_conversion_log      ENABLE ROW LEVEL SECURITY;
