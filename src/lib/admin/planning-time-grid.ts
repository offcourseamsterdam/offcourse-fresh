/**
 * Pure positioning math for the Planning week view's time-axis layout.
 *
 * The grid spans 09:00–24:00 Amsterdam-local (15 hours) at 1 minute = 1px
 * (PX_PER_HOUR = 60), so a block's vertical position is directly readable as
 * clock time. Blocks are positioned by their TOP edge only (`topPx`) — height
 * is content-driven (`min-height`, never compressed below MIN_BLOCK_PX), so
 * text is never squeezed illegible for a short cruise. See
 * docs/features/admin-bookings-search-and-planning.md for the design-panel
 * writeup that led to this approach over grid-row/flex-gap alternatives.
 */

export const GRID_START_HOUR = 9
export const GRID_END_HOUR = 24
export const PX_PER_HOUR = 60
export const MIN_BLOCK_PX = 44
export const RAIL_WIDTH_PX = 40
export const GRID_HEIGHT_PX = (GRID_END_HOUR - GRID_START_HOUR) * PX_PER_HOUR

/** Minutes since midnight, in Amsterdam local time, for a given ISO instant. */
export function amsterdamMinutesSinceMidnight(iso: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Europe/Amsterdam',
  }).formatToParts(new Date(iso))
  const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return hour * 60 + minute
}

/**
 * Pixel offset from the top of the grid for a given start time, clamped to
 * the visible 09:00–24:00 window (a booking outside that window — shouldn't
 * happen in practice for this business — pins to the nearest edge rather
 * than rendering off-grid or breaking layout).
 */
export function topPx(startIso: string | null): number {
  if (!startIso) return 0
  const minutesSinceMidnight = amsterdamMinutesSinceMidnight(startIso)
  const minutesSinceGridStart = minutesSinceMidnight - GRID_START_HOUR * 60
  return Math.min(Math.max(minutesSinceGridStart, 0), GRID_HEIGHT_PX)
}

/** min-height in px for a block — its real duration, floored so short
 *  cruises still get enough room to render readable text (not compressed). */
export function blockMinHeightPx(startIso: string | null, endIso: string | null): number {
  if (!startIso || !endIso) return MIN_BLOCK_PX
  const startMin = amsterdamMinutesSinceMidnight(startIso)
  let endMin = amsterdamMinutesSinceMidnight(endIso)
  if (endMin <= startMin) endMin += 24 * 60 // crossed midnight (shouldn't happen here, but stay safe)
  const durationMin = endMin - startMin
  return Math.max(durationMin, MIN_BLOCK_PX)
}

export interface HourMark {
  hour: number
  topPx: number
  label: string
}

/** The hour gridlines/labels for the grid, 09:00 through 24:00 inclusive.
 *  The last mark reads "00:00" (midnight), not "24:00" — clearer to a reader
 *  even though the underlying hour value (24) is what the positioning math uses. */
export function hourMarks(): HourMark[] {
  const marks: HourMark[] = []
  for (let hour = GRID_START_HOUR; hour <= GRID_END_HOUR; hour++) {
    const displayHour = hour % 24
    marks.push({
      hour,
      topPx: (hour - GRID_START_HOUR) * PX_PER_HOUR,
      label: `${String(displayHour).padStart(2, '0')}:00`,
    })
  }
  return marks
}
