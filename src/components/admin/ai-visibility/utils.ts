/**
 * Parse an incoming entry page URL to extract cruise slug, date, and time parameters.
 */
export function parseDeepLinkDetails(entryPage: string): {
  cruiseSlug: string
  date: string | null
  time: string | null
} {
  try {
    const url = new URL(entryPage, 'https://offcourse.amsterdam')
    const pathname = url.pathname.replace(/^\/[a-z]{2}\//, '/')
    const date = url.searchParams.get('date')
    const time = url.searchParams.get('time')
    const cruiseSlug = pathname.replace('/cruises/', '').replace(/\/$/, '')
    return { cruiseSlug, date, time }
  } catch {
    return { cruiseSlug: entryPage, date: null, time: null }
  }
}

/**
 * Format an ISO timestamp into a human-friendly relative or local time string.
 */
export function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Nog niet gesynchroniseerd'
  try {
    const date = new Date(isoString)
    const now = new Date()
    const diffSec = Math.round((now.getTime() - date.getTime()) / 1000)

    if (diffSec < 60) return 'Zojuist'
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min geleden`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} uur geleden`
    return date.toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoString
  }
}
