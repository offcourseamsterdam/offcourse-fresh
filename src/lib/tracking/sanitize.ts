/**
 * UTM parameter sanitization and validation.
 * Ensures clean, consistent data enters the database.
 */
import { KNOWN_UTM_SOURCES } from './constants'

/**
 * Sanitize a single UTM value:
 * - Trim whitespace
 * - Lowercase
 * - Strip values over 100 chars
 * - Remove characters that aren't URL-safe
 * - Returns null if empty after sanitization
 */
export function sanitizeUTMValue(value: string | undefined | null): string | null {
  if (!value) return null
  let clean = value.trim().toLowerCase()
  if (clean.length > 100) clean = clean.slice(0, 100)
  // Only allow alphanumeric, hyphens, underscores, dots, plus signs
  clean = clean.replace(/[^a-z0-9\-_\.+]/g, '')
  return clean || null
}

/**
 * Check if a utm_source is a known/trusted source.
 * Unknown sources are still recorded but can be flagged in the dashboard.
 */
export function isKnownSource(source: string | null): boolean {
  if (!source) return false
  return KNOWN_UTM_SOURCES.includes(source)
}

/**
 * Sanitize all UTM parameters from a session payload.
 * Returns cleaned values + a flag indicating if the source is verified.
 */
export function sanitizeUTMParams(params: {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}): {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  is_verified_source: boolean
} {
  const utm_source = sanitizeUTMValue(params.utm_source)
  return {
    utm_source,
    utm_medium: sanitizeUTMValue(params.utm_medium),
    utm_campaign: sanitizeUTMValue(params.utm_campaign),
    utm_term: sanitizeUTMValue(params.utm_term),
    utm_content: sanitizeUTMValue(params.utm_content),
    is_verified_source: isKnownSource(utm_source),
  }
}
