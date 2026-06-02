// Google Ads fixed constant IDs for geo targeting and languages.
//
// These IDs are global and stable across all accounts — they come from Google's
// published geoTargetConstant / languageConstant tables. We keep a small curated
// map of the markets Off Course actually cares about (Amsterdam tourists come
// mostly from NL, DE, UK, US, plus nearby EU). Extend as needed.
//
// Full lists:
//   geo:      https://developers.google.com/google-ads/api/data/geotargets
//   language: https://developers.google.com/google-ads/api/data/codes-formats#languages

/** Country name (lower-case) → geoTargetConstant numeric id. */
export const GEO_TARGETS: Record<string, number> = {
  netherlands: 2528,
  germany: 2276,
  'united kingdom': 2826,
  uk: 2826,
  'united states': 2840,
  usa: 2840,
  us: 2840,
  belgium: 2056,
  france: 2250,
  spain: 2724,
  italy: 2380,
  ireland: 2372,
  switzerland: 2756,
  austria: 2040,
  australia: 2036,
  canada: 2124,
}

/** Language name (lower-case) → languageConstant numeric id. */
export const LANGUAGES: Record<string, number> = {
  english: 1000,
  german: 1001,
  french: 1002,
  spanish: 1003,
  italian: 1004,
  dutch: 1010,
}

export function geoConstant(country: string): string {
  const id = GEO_TARGETS[country.trim().toLowerCase()]
  if (!id) {
    throw new Error(
      `Unknown country "${country}". Known: ${Object.keys(GEO_TARGETS).join(', ')}. ` +
        `Add it to GEO_TARGETS in geo-constants.ts (id from Google's geo target table).`,
    )
  }
  return `geoTargetConstants/${id}`
}

export function languageConstant(language: string): string {
  const id = LANGUAGES[language.trim().toLowerCase()]
  if (!id) {
    throw new Error(
      `Unknown language "${language}". Known: ${Object.keys(LANGUAGES).join(', ')}. ` +
        `Add it to LANGUAGES in geo-constants.ts.`,
    )
  }
  return `languageConstants/${id}`
}
