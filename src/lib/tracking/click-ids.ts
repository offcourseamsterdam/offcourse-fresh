// Google ad click identifiers. A click carries exactly one of these:
//   gclid  — the standard click id (desktop / Android / most web)
//   wbraid — iOS web-to-web in privacy-restricted state
//   gbraid — iOS app-to-web (ad tapped inside an app → Safari)
// Each must be uploaded to its OWN field — a wbraid sent as a gclid won't match.
// Priority order: prefer gclid, then wbraid, then gbraid.

export const CLICK_ID_PARAMS = ['gclid', 'wbraid', 'gbraid'] as const
export type ClickType = (typeof CLICK_ID_PARAMS)[number]

/**
 * Pick the click id present in a query string. `get` is any lookup function
 * (URLSearchParams.get, request.nextUrl.searchParams.get, etc.) so this stays
 * environment-agnostic and easy to test.
 */
export function pickClickId(get: (key: string) => string | null | undefined): {
  value: string
  type: ClickType
} | null {
  for (const type of CLICK_ID_PARAMS) {
    const value = get(type)
    if (value) return { value, type }
  }
  return null
}

/** Validate an arbitrary string as a known click type, defaulting to 'gclid'. */
export function toClickType(value: string | null | undefined): ClickType {
  return (CLICK_ID_PARAMS as readonly string[]).includes(value ?? '')
    ? (value as ClickType)
    : 'gclid'
}
