-- Fix infinite recursion in user_profiles RLS policies.
--
-- The "Admins: read all profiles" policy had a subquery on user_profiles
-- to check if the current user is an admin — but since the subquery
-- targets the same table the policy guards, PostgreSQL detects infinite
-- recursion (error 42P17) and the query fails silently.
--
-- Fix: use auth.jwt() metadata instead of re-querying the table.

DROP POLICY IF EXISTS "Admins: read all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins: update all profiles" ON public.user_profiles;

-- Allow: own row, service_role, or admin (via JWT app_metadata)
CREATE POLICY "Admins: read all profiles" ON public.user_profiles
  FOR SELECT
  USING (
    auth.uid() = id
    OR auth.jwt()->>'role' = 'service_role'
    OR (auth.jwt()->'app_metadata'->>'role') = 'admin'
  );

CREATE POLICY "Admins: update all profiles" ON public.user_profiles
  FOR UPDATE
  USING (
    auth.uid() = id
    OR auth.jwt()->>'role' = 'service_role'
    OR (auth.jwt()->'app_metadata'->>'role') = 'admin'
  );
