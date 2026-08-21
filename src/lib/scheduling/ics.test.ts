import { describe, it, expect } from 'vitest'
import { buildShiftIcs, type IcsShift } from './ics'

const stamp = '2026-06-12T00:00:00.000Z'

function shift(over: Partial<IcsShift> = {}): IcsShift {
  return {
    id: 'sh1',
    start_at: '2026-06-21T12:00:00.000Z',
    end_at: '2026-06-21T14:00:00.000Z',
    boatName: 'Diana',
    status: 'confirmed',
    notes: null,
    tripTitle: null,
    guestCount: null,
    departureLocation: null,
    ...over,
  }
}

describe('buildShiftIcs', () => {
  it('wraps events in a VCALENDAR with required headers', () => {
    const ics = buildShiftIcs([], { calendarName: 'Joris — Off Course', stamp })
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain('VERSION:2.0')
    expect(ics).toContain('END:VCALENDAR')
    expect(ics).toContain('X-WR-CALNAME:Joris — Off Course')
  })

  it('uses CRLF line endings', () => {
    const ics = buildShiftIcs([], { calendarName: 'x', stamp })
    expect(ics).toContain('\r\n')
  })

  it('emits one VEVENT per shift with UTC timestamps', () => {
    const ics = buildShiftIcs([shift()], { calendarName: 'x', stamp })
    expect(ics).toContain('BEGIN:VEVENT')
    expect(ics).toContain('UID:shift-sh1@offcourseamsterdam.com')
    expect(ics).toContain('DTSTART:20260621T120000Z')
    expect(ics).toContain('DTEND:20260621T140000Z')
    expect(ics).toContain('DTSTAMP:20260612T000000Z')
  })

  it('names the boat in the summary', () => {
    const ics = buildShiftIcs([shift({ boatName: 'Curaçao' })], { calendarName: 'x', stamp })
    expect(ics).toContain('SUMMARY:⚓ Curaçao')
  })

  it('marks assigned (unconfirmed) shifts in the summary', () => {
    const ics = buildShiftIcs([shift({ status: 'assigned' })], { calendarName: 'x', stamp })
    expect(ics).toContain('(to confirm)')
  })

  it('falls back to Boat TBD when no boat', () => {
    const ics = buildShiftIcs([shift({ boatName: null })], { calendarName: 'x', stamp })
    expect(ics).toContain('Boat TBD')
  })

  it('puts status and notes in the description', () => {
    const ics = buildShiftIcs([shift({ notes: 'Bring the speaker' })], { calendarName: 'x', stamp })
    expect(ics).toContain('Status: confirmed')
    expect(ics).toContain('Bring the speaker')
  })

  it('escapes special characters in notes', () => {
    const ics = buildShiftIcs([shift({ notes: 'a, b; c' })], { calendarName: 'x', stamp })
    expect(ics).toContain('a\\, b\\; c')
  })

  it('produces no VEVENT for an empty list', () => {
    const ics = buildShiftIcs([], { calendarName: 'x', stamp })
    expect(ics).not.toContain('BEGIN:VEVENT')
  })

  it('includes the trip title in the summary and description', () => {
    const ics = buildShiftIcs([shift({ tripTitle: 'Sunset Cruise' })], { calendarName: 'x', stamp })
    expect(ics).toContain('SUMMARY:⚓ Diana — Sunset Cruise')
    expect(ics).toContain('Trip: Sunset Cruise')
  })

  it('includes guest count in the description', () => {
    const ics = buildShiftIcs([shift({ guestCount: 6 })], { calendarName: 'x', stamp })
    expect(ics).toContain('Guests: 6')
  })

  it('uses the trip departure location, falling back to the default address', () => {
    const withLocation = buildShiftIcs([shift({ departureLocation: 'De Ruijterkade 44' })], {
      calendarName: 'x',
      stamp,
    })
    expect(withLocation).toContain('LOCATION:De Ruijterkade 44')

    const withoutLocation = buildShiftIcs([shift()], { calendarName: 'x', stamp })
    expect(withoutLocation).toContain('LOCATION:Off Course\\, Amsterdam')
  })

  it('omits trip/guest lines for shifts with no linked booking', () => {
    const ics = buildShiftIcs([shift()], { calendarName: 'x', stamp })
    expect(ics).not.toContain('Trip:')
    expect(ics).not.toContain('Guests:')
  })
})
