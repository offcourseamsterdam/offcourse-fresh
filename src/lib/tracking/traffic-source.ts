import { resolveChannelSlug } from './attribution'

/**
 * Traffic source derivation — answers "where did this customer come from?"
 * at checkout time, from first-party signals only:
 *
 *   1. oc_gclid cookie        → they clicked a Google ad (strongest signal)
 *   2. oc_attr cookie         → they came through a /t/<slug> campaign link
 *   3. oc_src cookie          → first-touch referrer/UTM captured on landing
 *   4. none of the above      → direct
 *
 * The result is written into Stripe PaymentIntent metadata and persisted on
 * the booking row by the webhook, so revenue can be attributed per channel.
 */

/** Compact first-touch payload stored in the oc_src cookie (set once, 90 days). */
export interface FirstTouch {
  /** External referrer hostname (e.g. "www.instagram.com"). */
  ref?: string
  /** utm_source of the landing URL. */
  src?: string
  /** utm_medium of the landing URL. */
  med?: string
  /** utm_campaign of the landing URL. */
  cmp?: string
  /** Landing pathname (e.g. "/en/cruises/hidden-gems"). */
  lp?: string
  /** Capture time, epoch seconds. */
  ts?: number
}

export interface TrafficSourceInput {
  /** Google click id (oc_gclid cookie), any kind: gclid/wbraid/gbraid. */
  gclid?: string | null
  /** Campaign slug from the oc_attr cookie (set by /t/<slug> links). */
  campaignSlug?: string | null
  /** First-touch data from the oc_src cookie. */
  firstTouch?: FirstTouch | null
}

export interface TrafficSource {
  /** Channel: google-ads | campaign | social | email | organic | referral | partners | direct */
  source: string
  /** The specific origin: campaign slug, utm_source, or referrer host. */
  detail: string | null
}

const FIELD_MAX = 200

export function deriveTrafficSource(input: TrafficSourceInput): TrafficSource {
  const { gclid, campaignSlug, firstTouch } = input

  // 1. A Google click id always means a paid Google click, regardless of how
  //    the visitor navigated afterwards.
  if (gclid && gclid.trim()) {
    return { source: 'google-ads', detail: campaignSlug ?? firstTouch?.cmp ?? null }
  }

  // 2. Campaign tracking link (/t/<slug>) — QR codes, bio links, partner links.
  if (campaignSlug && campaignSlug.trim()) {
    return { source: 'campaign', detail: campaignSlug }
  }

  // 3. First-touch UTM / referrer, mapped through the shared channel resolver
  //    so the vocabulary matches the campaigns dashboard.
  if (firstTouch && (firstTouch.src || firstTouch.med || firstTouch.ref)) {
    const referrerUrl = firstTouch.ref ? `https://${firstTouch.ref}` : null
    const source = resolveChannelSlug(firstTouch.src ?? null, firstTouch.med ?? null, referrerUrl)
    return { source, detail: firstTouch.src ?? firstTouch.ref ?? null }
  }

  // 4. Nothing — typed the URL, bookmark, or untagged link.
  return { source: 'direct', detail: null }
}

/**
 * Parse the oc_src cookie value defensively — it's client-writable, so treat
 * it as untrusted input: must be a JSON object, strings only, length-capped.
 * Returns null for anything malformed.
 */
export function parseFirstTouch(raw: string | null | undefined): FirstTouch | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const obj = parsed as Record<string, unknown>
    const out: FirstTouch = {}
    for (const key of ['ref', 'src', 'med', 'cmp', 'lp'] as const) {
      const val = obj[key]
      if (typeof val === 'string' && val.trim()) out[key] = val.slice(0, FIELD_MAX)
    }
    if (typeof obj.ts === 'number' && Number.isFinite(obj.ts)) out.ts = obj.ts
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}
