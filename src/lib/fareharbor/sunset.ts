import { createServiceClient } from '@/lib/supabase/server'
import { toDateStr } from '@/lib/utils'

const AMSTERDAM_LAT = 52.3676
const AMSTERDAM_LNG = 4.9041
const CITY = 'amsterdam'

// ── External API ───────────────────────────────────────────────────────────

interface SunriseSunsetResponse {
  results: {
    sunrise: string
    sunset: string
  }
  status: string
}

/**
 * Fetch sunrise/sunset from sunrise-sunset.org for a given date.
 * Returns null if the request fails or times out.
 */
async function fetchFromApi(
  dateStr: string
): Promise<{ sunset: string; sunrise: string } | null> {
  try {
    const url =
      `https://api.sunrise-sunset.org/json` +
      `?lat=${AMSTERDAM_LAT}&lng=${AMSTERDAM_LNG}` +
      `&date=${dateStr}&formatted=0`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timeout)

    if (!res.ok) return null

    const data: SunriseSunsetResponse = await res.json()
    if (data.status !== 'OK') return null

    // Convert UTC ISO strings to Amsterdam local HH:MM
    const opts: Intl.DateTimeFormatOptions = {
      timeZone: 'Europe/Amsterdam',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }

    const sunset = new Date(data.results.sunset).toLocaleTimeString('en-GB', opts)
    const sunrise = new Date(data.results.sunrise).toLocaleTimeString('en-GB', opts)

    return { sunset, sunrise }
  } catch {
    // Network error, timeout, or JSON parse failure — all non-fatal
    return null
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the sunset time for Amsterdam on the given date.
 * Returns "HH:MM" (24h) or null if unavailable.
 *
 * Checks the Supabase `sunset_times` cache first, then falls back to the
 * sunrise-sunset.org API. Caches the result for future calls.
 */
export async function getSunsetTime(date: Date): Promise<string | null> {
  const dateStr = toDateStr(date)
  const supabase = await createServiceClient()

  // 1. Check cache
  try {
    const { data: cached } = await supabase
      .from('sunset_times' as any) // TODO: create sunset_times table migration
      .select('sunset_time')
      .eq('date', dateStr)
      .eq('city', CITY)
      .single() as { data: { sunset_time: string } | null }

    if (cached?.sunset_time) return cached.sunset_time
  } catch {
    // No cached row — continue to API
  }

  // 2. Fetch from external API
  const result = await fetchFromApi(dateStr)
  if (!result) return null

  // 3. Cache in Supabase
  try {
    await supabase.from('sunset_times' as any) // TODO: create sunset_times table migration.upsert(
      {
        date: dateStr,
        city: CITY,
        sunset_time: result.sunset,
        sunrise_time: result.sunrise,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: 'date,city' }
    )
  } catch {
    // Cache write failed — non-fatal, we still have the value
  }

  return result.sunset
}

/**
 * Pre-seed sunset times for the next N days so that real-time lookups
 * always hit the cache. Skips dates that are already stored.
 *
 * Returns the number of newly fetched dates.
 */
export async function preSeedSunsetTimes(daysAhead: number = 90): Promise<number> {
  const supabase = await createServiceClient()
  let fetched = 0

  // Build the list of dates we need
  const dates: string[] = []
  const today = new Date()
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    dates.push(toDateStr(d))
  }

  // Find which dates are already cached
  let cachedDates = new Set<string>()
  try {
    const { data: existing } = await supabase
      .from('sunset_times' as any) // TODO: create sunset_times table migration
      .select('date')
      .eq('city', CITY)
      .in('date', dates)

    if (existing) {
      cachedDates = new Set((existing as any[]).map((r) => r.date))
    }
  } catch {
    // If the query fails we'll just fetch everything
  }

  const missing = dates.filter((d) => !cachedDates.has(d))

  for (const dateStr of missing) {
    const result = await fetchFromApi(dateStr)
    if (!result) continue

    try {
      await supabase.from('sunset_times' as any) // TODO: create sunset_times table migration.upsert(
        {
          date: dateStr,
          city: CITY,
          sunset_time: result.sunset,
          sunrise_time: result.sunrise,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'date,city' }
      )
      fetched++
    } catch {
      // Individual write failure — skip and continue
    }

    // Be polite to the free API
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  return fetched
}
