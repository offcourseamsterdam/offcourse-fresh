import type { Locale } from './config'

/**
 * Reads a localized field from a Supabase row.
 * For locale 'en' (default), reads the base field name.
 * For other locales, reads `field_${locale}` and falls back to the base field.
 *
 * @example
 * getLocalizedField(listing, 'title', 'nl')
 * // → listing.title_nl ?? listing.title
 */
export function getLocalizedField<T extends Record<string, unknown>>(
  row: T,
  field: string,
  locale: Locale
): string {
  if (locale === 'en') {
    return (row[field] as string) ?? ''
  }

  const localizedKey = `${field}_${locale}`
  const localizedValue = row[localizedKey] as string | null | undefined
  const fallback = row[field] as string | null | undefined

  return localizedValue || fallback || ''
}
