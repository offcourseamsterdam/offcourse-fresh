-- 163_revolut_refresh_lock_rpc.sql
-- Atomic lock acquisition for Revolut token refresh.
-- PostgREST has a known issue where applying an .or() filter to an UPDATE query
-- attempts to qualify columns with the table name (e.g. revolut_connection.refresh_lock_until),
-- which causes Postgres error 42703 (undefined column in aliased UPDATE).
-- This RPC executes the atomic lock update directly in PostgreSQL.

CREATE OR REPLACE FUNCTION public.acquire_revolut_refresh_lock(p_lock_until timestamptz, p_now timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.revolut_connection
  SET refresh_lock_until = p_lock_until
  WHERE id = 'default'
    AND (refresh_lock_until IS NULL OR refresh_lock_until < p_now);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;
