-- Migration: 001_user_profiles
-- Creates the user_profiles table, role enum, and auto-create trigger.
-- Run this in the Supabase SQL editor before using any auth features.

-- Role enum
CREATE TYPE public.user_role AS ENUM ('admin', 'support', 'captain', 'guest', 'partner');

-- user_profiles table (1-to-1 with auth.users)
CREATE TABLE public.user_profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT        NOT NULL,
  display_name  TEXT,
  role          public.user_role NOT NULL DEFAULT 'guest',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-create a profile row when a new auth user is created
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, role)
  VALUES (NEW.id, NEW.email, 'guest');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_profiles_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users: read own profile"
  ON public.user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Admins can read all profiles
CREATE POLICY "Admins: read all profiles"
  ON public.user_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Admins can update any profile (role, is_active)
CREATE POLICY "Admins: update all profiles"
  ON public.user_profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Users can update their own display_name only (not role/is_active)
-- This is enforced at the API layer since WITH CHECK can't reference old rows easily
CREATE POLICY "Users: update own display_name"
  ON public.user_profiles FOR UPDATE
  USING (auth.uid() = id);

-- Service role can insert (for the trigger and admin invite flow)
-- (service role bypasses RLS by default — no policy needed)

-- ─────────────────────────────────────────────────────────────
-- AFTER RUNNING THIS MIGRATION:
-- 1. Create your own account via the login page (magic link)
-- 2. Run the seed query below to make yourself admin:
--
--    UPDATE public.user_profiles
--    SET role = 'admin'
--    WHERE email = 'your@email.com';
--
-- 3. Regenerate TypeScript types:
--    npx supabase gen types typescript --project-id fkylzllxvepmrtqxisrn > src/lib/supabase/types.ts
-- ─────────────────────────────────────────────────────────────
