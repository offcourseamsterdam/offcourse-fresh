import { getAccessToken } from './auth'

// Shared low-level client for the Google Ads REST API. Both the conversion
// upload and the refund adjustment go through googleAdsPost, so auth, the API
// version, the request timeout, and error handling live in exactly one place.

// The Google Ads API version is sunset ~yearly. Keep it in an env var so it can
// be bumped without a code change — set it to the current version shown in your
// Google Ads API Center. Falls back to a recent default.
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v18'
const TIMEOUT_MS = 10_000

export interface GoogleAdsConfig {
  customerId: string
  developerToken: string
  /** Full resource name: customers/<id>/conversionActions/<id> */
  conversionAction: string
  loginCustomerId: string
}

/** Read + validate env config. Returns { error } when anything required is missing. */
export function getConfig(): GoogleAdsConfig | { error: string } {
  const customerId = (process.env.GOOGLE_ADS_CUSTOMER_ID ?? '').replace(/-/g, '')
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN
  const conversionActionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID
  const loginCustomerId = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/-/g, '')

  if (!customerId || !developerToken || !conversionActionId) {
    return {
      error:
        'Google Ads not configured (need GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CONVERSION_ACTION_ID)',
    }
  }

  return {
    customerId,
    developerToken,
    conversionAction: `customers/${customerId}/conversionActions/${conversionActionId}`,
    loginCustomerId,
  }
}

export interface GoogleAdsResult {
  ok: boolean
  status: number
  /** Google's partial-failure message, if the row was rejected. */
  partialFailure?: string | null
  raw?: unknown
  error?: string
}

/**
 * POST to a Google Ads customer method (e.g. 'uploadClickConversions').
 * NEVER throws — returns a result object so webhook callers stay safe.
 */
export async function googleAdsPost(
  cfg: GoogleAdsConfig,
  method: string,
  body: unknown,
): Promise<GoogleAdsResult> {
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
  if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId

  try {
    const res = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${cfg.customerId}:${method}`,
      { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) },
    )
    const raw = (await res.json().catch(() => null)) as
      | { partialFailureError?: { message?: string } }
      | null
    const partialFailure = raw?.partialFailureError?.message ?? null
    return { ok: res.ok && !partialFailure, status: res.status, partialFailure, raw }
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) }
  }
}
