import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/search/fetch-search-results', () => ({ fetchSearchResults: vi.fn() }))

import { checkOtaAvailability } from './check-availability'
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
        availableSlots: [{ startTime: '10:30am', customerTypes: [{ name: 'Diana - 2 Hours', priceCents: 20000, durationMinutes: 120 }] }],
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
})
