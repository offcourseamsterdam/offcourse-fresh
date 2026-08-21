/**
 * Minimal iCalendar (RFC 5545) feed builder for a captain's shifts. Calendar
 * apps (Google/Apple) poll the feed URL on their own schedule, so this just
 * needs to emit a valid VCALENDAR with one VEVENT per shift.
 */

export interface IcsShift {
  id: string
  start_at: string
  end_at: string
  boatName: string | null
  status: string
  notes: string | null
  tripTitle: string | null
  guestCount: number | null
  departureLocation: string | null
}

/** RFC 5545 text escaping: backslash, comma, semicolon, newline. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** UTC timestamp in iCal basic format: 20260621T140000Z */
function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Fold lines to 75 octets per RFC 5545. We approximate on characters, which is
 * safe for our ASCII-ish content and avoids importers choking on long lines.
 */
function fold(line: string): string {
  if (line.length <= 75) return line
  const parts: string[] = []
  let rest = line
  parts.push(rest.slice(0, 75))
  rest = rest.slice(75)
  while (rest.length > 74) {
    parts.push(' ' + rest.slice(0, 74))
    rest = rest.slice(74)
  }
  if (rest.length) parts.push(' ' + rest)
  return parts.join('\r\n')
}

export function buildShiftIcs(
  shifts: IcsShift[],
  opts: { calendarName: string; stamp: string },
): string {
  const dtstamp = toIcsUtc(opts.stamp)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Off Course//Captain Shifts//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.calendarName)}`,
    'X-WR-TIMEZONE:Europe/Amsterdam',
  ]

  for (const shift of shifts) {
    const boat = shift.boatName ?? 'Boat TBD'
    const summaryBits = [`⚓ ${boat}`]
    if (shift.tripTitle) summaryBits.push(`— ${shift.tripTitle}`)
    if (shift.status === 'assigned') summaryBits.push('(to confirm)')
    const descParts = [`Status: ${shift.status}`]
    if (shift.tripTitle) descParts.push(`Trip: ${shift.tripTitle}`)
    if (shift.guestCount != null) descParts.push(`Guests: ${shift.guestCount}`)
    if (shift.notes) descParts.push(shift.notes)

    lines.push(
      'BEGIN:VEVENT',
      `UID:shift-${shift.id}@offcourseamsterdam.com`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${toIcsUtc(shift.start_at)}`,
      `DTEND:${toIcsUtc(shift.end_at)}`,
      fold(`SUMMARY:${escapeText(summaryBits.join(' '))}`),
      fold(`DESCRIPTION:${escapeText(descParts.join(' — '))}`),
      `LOCATION:${escapeText(shift.departureLocation ?? 'Off Course, Amsterdam')}`,
      'END:VEVENT',
    )
  }

  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}
