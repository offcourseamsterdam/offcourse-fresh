import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/search/fetch-search-results', () => ({ fetchSearchResults: vi.fn() }))

import { checkOtaAvailability, requestedTime } from './check-availability'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'
import type { OtaDetection } from './detect'

const BASE_OTA: OtaDetection = {
  platform: 'withlocals',
  kind: 'new_request',
  bookingRef: '39f8dc7a',
  guestName: null,
  guestEmail: null,
  guestPhone: null,
  endTime: null,
  stripePaymentIntentId: null,
  parsed: { date: 'Thursday, September 24, 2026 at 10:30', time: null, dateISO: '2026-09-24', guests: 2, experienceName: 'Private Canal Cruise' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkOtaAvailability', () => {
  it('calls the real availability lookup with the parsed date and guest count', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue([
      {
        listing: { slug: 'private-hidden-gems-cruise', title: 'Private Hidden Gems Cruise', category: 'private' },
        availableSlots: [{ startTime: '10:30am', startAt: '2026-09-24T10:30:00+02:00', customerTypes: [{ name: 'Diana - 2 Hours', priceCents: 20000, durationMinutes: 120 }] }],
      },
    ] as never)

    const result = await checkOtaAvailability(BASE_OTA)
    expect(fetchSearchResults).toHaveBeenCalledWith('2026-09-24', 2)
    expect(result.checked).toBe(true)
    expect(result.dateISO).toBe('2026-09-24')
    expect(result.guests).toBe(2)
    expect(result.availability).toMatchObject({ available: true })
  })

  it('reports unchecked when the date could not be parsed', async () => {
    const ota = { ...BASE_OTA, parsed: { ...BASE_OTA.parsed, dateISO: null } }
    const result = await checkOtaAvailability(ota)
    expect(result.checked).toBe(false)
    expect(fetchSearchResults).not.toHaveBeenCalled()
  })

  it('reports unchecked when the guest count could not be parsed', async () => {
    const ota = { ...BASE_OTA, parsed: { ...BASE_OTA.parsed, guests: null } }
    const result = await checkOtaAvailability(ota)
    expect(result.checked).toBe(false)
    expect(fetchSearchResults).not.toHaveBeenCalled()
  })

  // Regression: a Withlocals request for 18:30 read "Bookable" because an
  // earlier departure that day was free, priced from the first slot.
  it('only counts departures at the requested time', async () => {
    const curacao = { name: 'Curaçao - 1.5 Hours', priceCents: 39000, durationMinutes: 90, boatId: 'curacao', maximumParty: 12, totalCapacity: 1 }
    vi.mocked(fetchSearchResults).mockResolvedValue([
      {
        listing: { slug: 'private', title: 'Private Cruise', category: 'private' },
        availableSlots: [{ startTime: '11am', startAt: '2026-09-29T11:00:00+02:00', customerTypes: [curacao] }],
      },
    ] as never)
    const ota = { ...BASE_OTA, parsed: { ...BASE_OTA.parsed, date: 'Tuesday, September 29, 2026 at 18:30', dateISO: '2026-09-29', guests: 10 } }
    const result = await checkOtaAvailability(ota)
    expect(result.time).toBe('18:30')
    expect(result.availability).toMatchObject({ available: false })
  })

  it('reports bookable when the requested departure itself is free', async () => {
    const curacao = { name: 'Curaçao - 1.5 Hours', priceCents: 39000, durationMinutes: 90, boatId: 'curacao', maximumParty: 12, totalCapacity: 1 }
    vi.mocked(fetchSearchResults).mockResolvedValue([
      {
        listing: { slug: 'private', title: 'Private Cruise', category: 'private' },
        availableSlots: [
          { startTime: '11am', startAt: '2026-09-29T09:00:00Z', customerTypes: [curacao] },
          { startTime: '6:30pm', startAt: '2026-09-29T16:30:00Z', customerTypes: [curacao] },
        ],
      },
    ] as never)
    const ota = { ...BASE_OTA, parsed: { ...BASE_OTA.parsed, date: 'Tuesday, September 29, 2026 at 18:30', dateISO: '2026-09-29', guests: 10 } }
    const result = await checkOtaAvailability(ota)
    expect(result.availability).toMatchObject({ available: true, listings: [{ times: ['6:30pm'] }] })
  })

  it('checks the whole day when the email names no time', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue([
      {
        listing: { slug: 'private', title: 'Private Cruise', category: 'private' },
        availableSlots: [{ startTime: '11am', startAt: '2026-09-24T09:00:00Z', customerTypes: [] }],
      },
    ] as never)
    const ota = { ...BASE_OTA, parsed: { ...BASE_OTA.parsed, date: '24 September 2026' } }
    const result = await checkOtaAvailability(ota)
    expect(result.time).toBeUndefined()
    expect(result.availability).toMatchObject({ available: true })
  })
})

describe('requestedTime', () => {
  const base = BASE_OTA.parsed
  it('reads the time Withlocals embeds in its date line', () => {
    expect(requestedTime({ ...base, date: 'Tuesday, September 29, 2026 at 18:30' })).toBe('18:30')
  })
  it("prefers GetMyBoat's own time field and normalises 12h clocks", () => {
    expect(requestedTime({ ...base, time: '5:00 PM' })).toBe('17:00')
    expect(requestedTime({ ...base, time: '6:30pm' })).toBe('18:30')
    expect(requestedTime({ ...base, time: '12am' })).toBe('00:00')
  })
  it('returns null when there is no time or it is unreadable', () => {
    expect(requestedTime({ ...base, date: '24 September 2026' })).toBeNull()
    expect(requestedTime({ ...base, time: 'evening' })).toBeNull()
  })
})
