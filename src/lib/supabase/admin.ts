import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Admin Supabase client using the service role key.
 *
 * This uses the standard `createClient` (NOT the SSR `createServerClient`)
 * so the service role key genuinely bypasses RLS. Use this for server-side
 * operations that need to read/write any row regardless of the current user's
 * auth state — e.g. the auth callback reading user_profiles before the
 * session cookie is fully established.
 *
 * NEVER expose this client to the browser.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
