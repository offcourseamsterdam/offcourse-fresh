import { toDateStr } from '@/lib/utils'

const AMSTERDAM_LAT = 52.3676
const AMSTERDAM_LNG = 4.9041

interface SunriseSunsetResponse {
  results: { sunset: string }
  status: string
}

// In-memory cache of sunset time per date. Sunset for a given date is fixed, so
// caching for the lifetime of the server instance is safe and avoids re-hitting
// the free external API on every availability lookup.
const cache = new Map<string, string>()

/**
 * Fetch the Amsterdam sunset for a date from sunrise-sunset.org, as "HH:MM"
 * (24h, Europe/Amsterdam). Returns null on any failure (non-fatal).
 */
async function fetchFromApi(dateStr: string): Promise<string | null> {
  try {
    const url =
      `https://api.sunrise-sunset.org/json` +
      `?lat=${AMSTERDAM_LAT}&lng=${AMSTERDAM_LNG}` +
      `&date=${dateStr}&formatted=0`

    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null

    const data: SunriseSunsetResponse = await res.json()
    if (data.status !== 'OK') return null

    return new Date(data.results.sunset).toLocaleTimeString('en-GB', {
      timeZone: 'Europe/Amsterdam',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  } catch {
    // Network error, timeout, or JSON parse failure — all non-fatal
    return null
  }
}

/**
 * Get the sunset time for Amsterdam on the given date as "HH:MM" (24h),
 * or null if unavailable. Cached in-memory per date.
 *
 * Used by the availability filters for sunset-cruise time windows
 * (src/lib/fareharbor/filters.ts).
 */
export async function getSunsetTime(date: Date): Promise<string | null> {
  const dateStr = toDateStr(date)

  const cached = cache.get(dateStr)
  if (cached) return cached

  const sunset = await fetchFromApi(dateStr)
  if (sunset) cache.set(dateStr, sunset)
  return sunset
}
