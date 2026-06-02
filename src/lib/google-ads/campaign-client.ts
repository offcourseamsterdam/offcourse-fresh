import { getAccessToken } from './auth'

// Generic Google Ads REST client for CAMPAIGN MANAGEMENT (read + mutate).
//
// Deliberately separate from ./client.ts (the conversion-upload transport) so the
// proven money path stays untouched. This file only ever reads or writes campaign
// structure — it never reports conversions. It reuses the same OAuth (./auth) and
// the same API-version env var, so there's one source of truth for credentials.
//
// Unlike ./client.ts (which never throws, because a webhook must stay alive), the
// functions here return a typed result object AND a few helpers throw on hard
// config errors — appropriate for a CLI/admin tool where a loud failure is better
// than a silent skip.

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v20'
const BASE = 'https://googleads.googleapis.com'
const TIMEOUT_MS = 30_000 // mutates with many operations can be slower than a conversion upload

export interface CampaignConfig {
  /** Advertiser account that owns the campaigns (10 digits, no dashes). */
  customerId: string
  developerToken: string
  /** Manager (MCC) account — sent as login-customer-id. */
  loginCustomerId: string
}

/** Read + validate the env config needed for campaign management. */
export function getCampaignConfig(): CampaignConfig | { error: string } {
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, '')

  if (!customerId || !developerToken) {
    return {
      error:
        'Google Ads not configured (need GOOGLE_ADS_CUSTOMER_ID and GOOGLE_ADS_DEVELOPER_TOKEN). ' +
        'GOOGLE_ADS_LOGIN_CUSTOMER_ID is required when the advertiser sits under a manager (MCC).',
    }
  }
  return { customerId, developerToken, loginCustomerId }
}

export interface AdsCallResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  /** Human-readable error (request-level or first operation error). */
  error?: string
  /** The raw parsed JSON body, for debugging. */
  raw?: unknown
}

// Minimal shapes for the parts of a Google Ads error body we actually read.
interface AdsFieldError {
  message?: string
  errorCode?: Record<string, string>
  location?: { fieldPathElements?: Array<{ fieldName?: string; index?: number }> }
}
interface AdsErrorBody {
  error?: { message?: string; details?: Array<{ errors?: AdsFieldError[] }> }
  partialFailureError?: { message?: string }
}

/**
 * Pull the most useful message out of a Google Ads error body.
 * Google returns either { error: { message, details:[{ errors:[{ message, errorCode }] }] } }
 * or { partialFailureError: { message } }. We surface the most specific one(s),
 * including the field path — which is what turns a useless "required field not
 * present" into "...at mutate_operations[1].campaign_operation.create.<field>".
 */
export function extractAdsError(body: unknown, status: number): string {
  if (!body || typeof body !== 'object') return `HTTP ${status}`
  const b = body as AdsErrorBody

  // Request-level error (auth, bad GAQL, validation in validateOnly mode, etc.)
  const topMsg = b.error?.message
  const messages: string[] = []
  for (const d of b.error?.details ?? []) {
    for (const e of d.errors ?? []) {
      if (!e.message) continue
      const codeKey = e.errorCode ? Object.keys(e.errorCode)[0] : undefined
      const codeVal = codeKey && e.errorCode ? e.errorCode[codeKey] : undefined
      const code = codeKey ? ` [${codeKey}=${codeVal}]` : ''
      // fieldPathElements pinpoints the exact operation + field that failed.
      const fieldPath = (e.location?.fieldPathElements ?? [])
        .map(f => (f.index != null ? `${f.fieldName}[${f.index}]` : f.fieldName))
        .join('.')
      const where = fieldPath ? ` at ${fieldPath}` : ''
      messages.push(`${e.message}${code}${where}`)
    }
  }
  if (messages.length > 0) return messages.slice(0, 4).join(' | ')
  if (topMsg) return topMsg

  // Partial failure (when partialFailure:true and only some operations failed)
  const pf = b.partialFailureError?.message
  if (pf) return pf

  return `HTTP ${status}`
}

/**
 * Low-level call to any Google Ads endpoint.
 * @param path everything after `/{version}/` — e.g. `customers/123/googleAds:search`
 *             or `customers:listAccessibleCustomers`.
 */
export async function googleAdsCall<T = unknown>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
): Promise<AdsCallResult<T>> {
  const cfg = getCampaignConfig()
  if ('error' in cfg) return { ok: false, status: 0, error: cfg.error }

  let accessToken: string
  try {
    accessToken = await getAccessToken()
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'developer-token': cfg.developerToken,
  }
  // listAccessibleCustomers must NOT carry login-customer-id; everything else should.
  if (cfg.loginCustomerId && !path.startsWith('customers:')) {
    headers['login-customer-id'] = cfg.loginCustomerId
  }

  try {
    const res = await fetch(`${BASE}/${API_VERSION}/${path}`, {
      method: init.method,
      headers,
      body: init.body != null ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const raw = await res.json().catch(() => null)
    if (!res.ok) {
      return { ok: false, status: res.status, error: extractAdsError(raw, res.status), raw }
    }
    // A 200 can still carry a partialFailureError when partialFailure:true was set.
    const pf = (raw as { partialFailureError?: { message?: string } } | null)?.partialFailureError?.message
    if (pf) return { ok: false, status: res.status, error: pf, data: raw as T, raw }
    return { ok: true, status: res.status, data: raw as T, raw }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, status: 0, error: msg }
  }
}

/** Convenience: the customer resource prefix `customers/<id>`. */
export function customerPath(): string {
  const cfg = getCampaignConfig()
  if ('error' in cfg) throw new Error(cfg.error)
  return `customers/${cfg.customerId}`
}

/** Euros (major units) → micros, Google's integer money unit. €30 → 30_000_000. */
export function eurosToMicros(euros: number): number {
  return Math.round(euros * 1_000_000)
}

/** Micros → euros. 30_000_000 → 30. */
export function microsToEuros(micros: number | string): number {
  return Number(micros) / 1_000_000
}
