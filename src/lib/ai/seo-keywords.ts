export const SEO_KEYWORDS = {
  primary: [
    'Amsterdam canal cruise',
    'private boat tour Amsterdam',
    'electric boat Amsterdam',
    'sunset cruise Amsterdam',
    'shared canal cruise',
    'hidden gems Amsterdam',
    'Amsterdam boat rental',
  ],
  brand: [
    'Off Course Amsterdam',
    'Diana boat',
    'Curaçao boat',
    'your friend with a boat',
  ],
  locations: [
    'Amsterdam canals',
    'Jordaan',
    'Herenmarkt',
    'Prinsengracht',
    'Herengracht',
    'Keizersgracht',
    'Amsterdam city centre',
  ],
  vibes: [
    'local Amsterdam experience',
    'off the beaten path',
    'chill canal boat',
    'electric sustainable tour',
    'golden hour canal',
    'intimate boat ride',
    'friends on a boat',
  ],
} as const

export function flattenKeywords(): string[] {
  return [
    ...SEO_KEYWORDS.primary,
    ...SEO_KEYWORDS.brand,
    ...SEO_KEYWORDS.locations,
    ...SEO_KEYWORDS.vibes,
  ]
}
