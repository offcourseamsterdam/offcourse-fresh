import 'server-only'

/**
 * Whether the admin dev-login bypass button/endpoint is allowed to run in the
 * current environment.
 *
 * `ADMIN_DEV_BYPASS_SECRET` + `ADMIN_DEV_BYPASS_EMAIL` must both be set —
 * opt-in per environment (.env.local locally, Preview-scoped env vars on
 * Vercel). NEVER set either in Vercel's Production environment scope.
 *
 * On top of that, real production is hard-blocked regardless of the env vars
 * above: `VERCEL_ENV === 'production' && NODE_ENV !== 'development'`.
 * Both conditions are needed together because `vercel env pull` copies
 * Vercel's system env vars — including VERCEL_ENV — into `.env.local` as a
 * literal string as of pull time. Vercel itself never reads `.env.local` for
 * real deployments (it's gitignored and not uploaded), so this doesn't
 * weaken the production block there — but it does mean a stale
 * `VERCEL_ENV="production"` line can sit in a local `.env.local` in this
 * repo. `NODE_ENV` isn't affected by that: `next dev` always forces it to
 * 'development' no matter what's in `.env.local`, while every real Vercel
 * build (`next build`, both preview and production) forces 'production'. So
 * requiring NODE_ENV !== 'development' too means this only ever fires on a
 * genuine Vercel production deployment, never on localhost.
 */
export function isAdminDevBypassEnabled(): boolean {
  if (!process.env.ADMIN_DEV_BYPASS_SECRET || !process.env.ADMIN_DEV_BYPASS_EMAIL) return false
  if (process.env.VERCEL_ENV === 'production' && process.env.NODE_ENV !== 'development') return false
  return true
}
