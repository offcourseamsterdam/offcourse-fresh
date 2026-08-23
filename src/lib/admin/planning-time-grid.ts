/**
 * Pure positioning math for the Planning view's time-axis layout.
 *
 * The grid spans 09:00–24:00 Amsterdam-local (15 hours). A card/chip is drawn
 * at exactly its real duration and never grows past its end line — a tour
 * that visually overran its slot would make the whole grid untrustworthy for
 * spotting free water. Room for the content therefore comes from the SCALE,
 * not from letting blocks stretch. See
 * docs/features/admin-bookings-search-and-planning.md for the design-panel
 * writeup behind the original (vertical, mobile + legacy desktop) layout.
 *
 * Two parallel scales share this file:
 * - Vertical (`topPx`/`blockMinHeightPx`/`hourMarks`, `PX_PER_HOUR` = 100) —
 *   one day per column, time flows top-to-bottom. Still used on mobile,
 *   where a single day fills the screen width and can afford real height.
 * - Horizontal (`leftPx`/`blockMinWidthPx`/`hourMarksRow`,
 *   `PX_PER_HOUR_ROW` = 70) — one day per ROW, time flows left-to-right, used
 *   by the desktop week view so many days fit on screen without scrolling
 *   through a 1500px-tall column per day. Chips here are compact (time +
 *   guest count + captain status only) — full detail is one click away in
 *   the same booking/group modal the vertical cards already open.
 */

export const GRID_START_HOUR = 9
export const GRID_END_HOUR = 24
export const PX_PER_HOUR = 100
export const PX_PER_MINUTE = PX_PER_HOUR / 60
export const MIN_BLOCK_PX = 72
export const RAIL_WIDTH_PX = 40
export const GRID_HEIGHT_PX = (GRID_END_HOUR - GRID_START_HOUR) * PX_PER_HOUR

export const PX_PER_HOUR_ROW = 70
export const PX_PER_MINUTE_ROW = PX_PER_HOUR_ROW / 60
// A chip must stay wide enough for its time label even at the shortest real
// cruise duration — narrower than that and the label itself would clip.
export const MIN_CHIP_PX = 56
// Below this width a chip drops its second line (boat · captain · catering)
// and shows only the headline — two lines of 9px text in less space than
// this clip mid-word, which reads as broken rather than abbreviated.
export const CHIP_DETAIL_MIN_PX = 100
export const DATE_RAIL_WIDTH_PX = 96
export const GRID_WIDTH_PX = (GRID_END_HOUR - GRID_START_HOUR) * PX_PER_HOUR_ROW

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
 * Pixel offset from the start of the grid for a given start time, at the
 * given scale, clamped to the visible 09:00–24:00 window (a booking outside
 * that window — shouldn't happen in practice for this business — pins to the
 * nearest edge rather than rendering off-grid or breaking layout).
 */
function offsetPx(startIso: string | null, pxPerMinute: number, totalPx: number): number {
  if (!startIso) return 0
  const minutesSinceMidnight = amsterdamMinutesSinceMidnight(startIso)
  const minutesSinceGridStart = minutesSinceMidnight - GRID_START_HOUR * 60
  return Math.min(Math.max(minutesSinceGridStart * pxPerMinute, 0), totalPx)
}

/** Size in px for a block at the given scale — its real duration, floored so
 *  a very short slot still renders readable content rather than a sliver. */
function sizePx(startIso: string | null, endIso: string | null, pxPerMinute: number, minPx: number): number {
  if (!startIso || !endIso) return minPx
  const startMin = amsterdamMinutesSinceMidnight(startIso)
  let endMin = amsterdamMinutesSinceMidnight(endIso)
  if (endMin <= startMin) endMin += 24 * 60 // crossed midnight (shouldn't happen here, but stay safe)
  const durationMin = endMin - startMin
  return Math.max(durationMin * pxPerMinute, minPx)
}

/** Vertical offset from the top of the grid (mobile's per-day column). */
export function topPx(startIso: string | null): number {
  return offsetPx(startIso, PX_PER_MINUTE, GRID_HEIGHT_PX)
}

/** Height for a vertical block — see `sizePx`. */
export function blockMinHeightPx(startIso: string | null, endIso: string | null): number {
  return sizePx(startIso, endIso, PX_PER_MINUTE, MIN_BLOCK_PX)
}

/** Horizontal offset from the start of the grid (desktop's per-day row). */
export function leftPx(startIso: string | null): number {
  return offsetPx(startIso, PX_PER_MINUTE_ROW, GRID_WIDTH_PX)
}

/** Width for a horizontal chip — see `sizePx`. */
export function blockMinWidthPx(startIso: string | null, endIso: string | null): number {
  return sizePx(startIso, endIso, PX_PER_MINUTE_ROW, MIN_CHIP_PX)
}

/**
 * Horizontal offset for the "right now" marker on today's row, or null when
 * the current Amsterdam time falls outside the grid's 09:00–24:00 window
 * (early morning, mostly). Null rather than a clamped 0 on purpose: the
 * other offsets in this file clamp because a booking pinned to an edge is
 * still better than one rendered off-grid, but a *now* line pinned to 09:00
 * at 07:00 in the morning would actively lie about the time — callers draw
 * nothing instead.
 */
export function nowLeftPx(nowMs: number): number | null {
  const minutes = amsterdamMinutesSinceMidnight(new Date(nowMs).toISOString())
  if (minutes < GRID_START_HOUR * 60 || minutes > GRID_END_HOUR * 60) return null
  return (minutes - GRID_START_HOUR * 60) * PX_PER_MINUTE_ROW
}

export interface HourMark {
  hour: number
  topPx: number
  label: string
}

export interface HourMarkRow {
  hour: number
  leftPx: number
  label: string
}

/** The hour gridlines/labels for the grid, 09:00 through 24:00 inclusive.
 *  The last mark reads "00:00", not "24:00" — clearer to a reader even
 *  though the underlying hour value (24) is what the positioning math uses. */
export function hourMarks(): HourMark[] {
  const marks: HourMark[] = []
  for (let hour = GRID_START_HOUR; hour <= GRID_END_HOUR; hour++) {
    marks.push({ hour, topPx: (hour - GRID_START_HOUR) * PX_PER_HOUR, label: hourLabel(hour) })
  }
  return marks
}

/** Same hour gridlines/labels as `hourMarks`, at the horizontal-row scale. */
export function hourMarksRow(): HourMarkRow[] {
  const marks: HourMarkRow[] = []
  for (let hour = GRID_START_HOUR; hour <= GRID_END_HOUR; hour++) {
    marks.push({ hour, leftPx: (hour - GRID_START_HOUR) * PX_PER_HOUR_ROW, label: hourLabel(hour) })
  }
  return marks
}

function hourLabel(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`
}
