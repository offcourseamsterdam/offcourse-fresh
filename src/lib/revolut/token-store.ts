import 'server-only'

/**
 * The single shared token store for the Revolut connection.
 *
 * Why a database row and not module memory: Revolut invalidates the previous
 * access token on every refresh. On Vercel each lambda has its own memory, so
 * two instances refreshing independently would keep knocking each other out.
 * The row plus a short refresh lock makes "who refreshes" a single decision.
 *
 * Secrets are stored encrypted (crypto.ts); this module is the only reader.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { exchangeAuthorizationCode, normalizePrivateKey, refreshAccessToken, type RevolutEnvironment, type RevolutScope, type TokenResponse } from './auth'
import { RevolutClient } from './client'
import { decryptSecret, encryptSecret, getTokenKey } from './crypto'

type Admin = SupabaseClient<Database>
export type RevolutConnectionRow = Database['public']['Tables']['revolut_connection']['Row']

const REFRESH_MARGIN_MS = 3 * 60 * 1000 // refresh when < 3 min of the 40 min remain
const LOCK_MS = 20 * 1000
const CALLBACK_PATH = '/api/admin/finance/cockpit/revolut/callback'

export interface RevolutEnvConfig {
  environment: RevolutEnvironment
  clientId: string
  privateKeyPem: string
  redirectUri: string
  scopes: RevolutScope[]
}

export function getRevolutEnvConfig(env: Record<string, string | undefined> = process.env): RevolutEnvConfig | null {
  const clientId = env.REVOLUT_CLIENT_ID
  const key = env.REVOLUT_PRIVATE_KEY
  if (!clientId || !key) return null
  const environment: RevolutEnvironment = env.REVOLUT_ENV === 'production' ? 'production' : 'sandbox'
  const site = (env.REVOLUT_REDIRECT_URI ? null : env.NEXT_PUBLIC_SITE_URL) ?? null
  const redirectUri = env.REVOLUT_REDIRECT_URI ?? (site ? `${site.replace(/\/$/, '')}${CALLBACK_PATH}` : '')
  if (!redirectUri) return null
  return {
    environment,
    clientId,
    privateKeyPem: normalizePrivateKey(key),
    redirectUri,
    scopes: ['READ', 'WRITE'],
  }
}

export async function loadConnection(supabase: Admin): Promise<RevolutConnectionRow> {
  const { data, error } = await supabase.from('revolut_connection').select('*').eq('id', 'default').maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return data
  const { data: created, error: insErr } = await supabase.from('revolut_connection').insert({ id: 'default' }).select('*').single()
  if (insErr || !created) throw new Error(insErr?.message ?? 'Could not create revolut_connection')
  return created
}

export function isConnected(row: RevolutConnectionRow): boolean {
  return Boolean(row.refresh_token_enc && row.consented_at)
}

/** After the consent redirect: exchange the code and persist the tokens. */
export async function completeConsent(supabase: Admin, code: string, env: RevolutEnvConfig = mustEnv()): Promise<RevolutConnectionRow> {
  const tokens = await exchangeAuthorizationCode({ ...env, code })
  if (!tokens.refresh_token) throw new Error('Revolut did not return a refresh_token')
  const key = getTokenKey()
  const now = new Date()
  const { data, error } = await supabase
    .from('revolut_connection')
    .update({
      environment: env.environment,
      client_id: env.clientId,
      redirect_uri: env.redirectUri,
      scopes: env.scopes,
      refresh_token_enc: encryptSecret(tokens.refresh_token, key),
      access_token_enc: encryptSecret(tokens.access_token, key),
      access_token_expires_at: expiry(tokens, now),
      refresh_lock_until: null,
      consented_at: now.toISOString(),
      last_sync_error: null,
      updated_at: now.toISOString(),
    })
    .eq('id', 'default')
    .select('*')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'Could not store Revolut tokens')
  return data
}

export async function disconnect(supabase: Admin): Promise<void> {
  const { error } = await supabase
    .from('revolut_connection')
    .update({
      refresh_token_enc: null,
      access_token_enc: null,
      access_token_expires_at: null,
      refresh_lock_until: null,
      consented_at: null,
      webhook_id: null,
      webhook_url: null,
      webhook_secret_enc: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 'default')
  if (error) throw new Error(error.message)
}

/** A valid access token, refreshing through the shared lock when needed. */
export async function getAccessToken(supabase: Admin, opts: { force?: boolean; now?: Date; env?: RevolutEnvConfig } = {}): Promise<string> {
  const now = opts.now ?? new Date()
  let row = await loadConnection(supabase)
  if (!isConnected(row)) throw new Error('Revolut is not connected')
  const key = getTokenKey()

  if (!opts.force && tokenStillValid(row, now)) {
    return decryptSecret(row.access_token_enc as string, key)
  }

  // Try to take the lock. Only one caller wins; the rest wait for its result.
  // We use an RPC because PostgREST generates invalid SQL on UPDATE with .or() filters.
  const lockUntil = new Date(now.getTime() + LOCK_MS).toISOString()
  const { data: won } = await supabase.rpc('acquire_revolut_refresh_lock', {
    p_lock_until: lockUntil,
    p_now: now.toISOString(),
  })

  if (!won) {
    for (let i = 0; i < 10; i++) {
      await sleep(500)
      row = await loadConnection(supabase)
      if (tokenStillValid(row, new Date()) && (!row.refresh_lock_until || new Date(row.refresh_lock_until) < new Date())) {
        return decryptSecret(row.access_token_enc as string, key)
      }
    }
    throw new Error('Timed out waiting for another process to refresh the Revolut token')
  }

  try {
    const env = opts.env ?? mustEnv()
    const refreshToken = decryptSecret(row.refresh_token_enc as string, key)
    const tokens = await refreshAccessToken({ ...env, refreshToken })
    const patch: Database['public']['Tables']['revolut_connection']['Update'] = {
      access_token_enc: encryptSecret(tokens.access_token, key),
      access_token_expires_at: expiry(tokens, new Date()),
      refresh_lock_until: null,
      updated_at: new Date().toISOString(),
    }
    if (tokens.refresh_token) patch.refresh_token_enc = encryptSecret(tokens.refresh_token, key)
    const { error } = await supabase.from('revolut_connection').update(patch).eq('id', 'default')
    if (error) throw new Error(error.message)
    return tokens.access_token
  } catch (err) {
    await supabase.from('revolut_connection').update({ refresh_lock_until: null, last_sync_error: `token refresh: ${(err as Error).message}` }).eq('id', 'default')
    throw err
  }
}

/** A client wired to the shared store (refresh-on-401 included). */
export async function createRevolutClient(supabase: Admin, env: RevolutEnvConfig = mustEnv()): Promise<RevolutClient> {
  return new RevolutClient({
    environment: env.environment,
    getAccessToken: () => getAccessToken(supabase, { env }),
    onUnauthorized: async () => { await getAccessToken(supabase, { env, force: true }) },
  })
}

export function tokenStillValid(row: RevolutConnectionRow, now: Date): boolean {
  if (!row.access_token_enc || !row.access_token_expires_at) return false
  return new Date(row.access_token_expires_at).getTime() - now.getTime() > REFRESH_MARGIN_MS
}

function expiry(tokens: TokenResponse, from: Date): string {
  return new Date(from.getTime() + tokens.expires_in * 1000).toISOString()
}

function mustEnv(): RevolutEnvConfig {
  const env = getRevolutEnvConfig()
  if (!env) throw new Error('Revolut env is not configured (REVOLUT_CLIENT_ID, REVOLUT_PRIVATE_KEY, NEXT_PUBLIC_SITE_URL or REVOLUT_REDIRECT_URI)')
  return env
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
