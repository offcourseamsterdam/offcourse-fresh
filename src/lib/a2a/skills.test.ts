import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runSkill, isSkillId, SkillInputError } from './skills'

const h = vi.hoisted(() => ({
  getPublicCruiseList: vi.fn(),
  getFilteredAvailabilityBySlug: vi.fn(),
}))

vi.mock('@/lib/cruise/get-public-cruise-list', () => ({ getPublicCruiseList: h.getPublicCruiseList }))
vi.mock('@/lib/fareharbor/availability', () => ({ getFilteredAvailabilityBySlug: h.getFilteredAvailabilityBySlug }))

describe('isSkillId', () => {
  it('accepts the two implemented skill ids', () => {
    expect(isSkillId('list_cruises')).toBe(true)
    expect(isSkillId('check_availability')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isSkillId('book_cruise')).toBe(false)
    expect(isSkillId(undefined)).toBe(false)
    expect(isSkillId(42)).toBe(false)
  })
})

describe('runSkill("list_cruises")', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps the cruise list to the skill\'s snake_case output shape', async () => {
    h.getPublicCruiseList.mockResolvedValue([
      { slug: 'sunset', title: 'Sunset Cruise', tagline: 'Nice', category: 'private', priceDisplay: '€310', startingPrice: 310, durationDisplay: '1.5h', maxGuests: 12 },
    ])
    const result = await runSkill('list_cruises', {})
    expect(result).toEqual({
      cruises: [
        { slug: 'sunset', title: 'Sunset Cruise', tagline: 'Nice', category: 'private', price_display: '€310', starting_price: 310, duration_display: '1.5h', max_guests: 12 },
      ],
    })
    expect(h.getPublicCruiseList).toHaveBeenCalledWith('en')
  })

  it('defaults to English when no locale is given, and validates a given one', async () => {
    h.getPublicCruiseList.mockResolvedValue([])
    await runSkill('list_cruises', { locale: 'nl' })
    expect(h.getPublicCruiseList).toHaveBeenCalledWith('nl')

    await runSkill('list_cruises', { locale: 'not-a-locale' })
    expect(h.getPublicCruiseList).toHaveBeenCalledWith('en')
  })
})

describe('runSkill("check_availability")', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns slots on a valid request', async () => {
    h.getFilteredAvailabilityBySlug.mockResolvedValue({
      slots: [{ startTime: '14:00', startAt: '2026-07-04T14:00:00+02:00', endAt: '2026-07-04T15:30:00+02:00', headline: 'Diana', capacity: 8 }],
      reasonCode: null,
    })
    const result = await runSkill('check_availability', { slug: 'sunset', date: '2026-07-04', guests: 4 })
    expect(h.getFilteredAvailabilityBySlug).toHaveBeenCalledWith('sunset', '2026-07-04', 4)
    expect(result).toEqual({
      slug: 'sunset',
      date: '2026-07-04',
      guests: 4,
      reasonCode: null,
      slots: [{ startTime: '14:00', startAt: '2026-07-04T14:00:00+02:00', endAt: '2026-07-04T15:30:00+02:00', headline: 'Diana', capacity: 8 }],
    })
  })

  it('defaults guests to 2 when omitted', async () => {
    h.getFilteredAvailabilityBySlug.mockResolvedValue({ slots: [], reasonCode: 'NO_AVAILABILITIES' })
    await runSkill('check_availability', { slug: 'sunset', date: '2026-07-04' })
    expect(h.getFilteredAvailabilityBySlug).toHaveBeenCalledWith('sunset', '2026-07-04', 2)
  })

  it('rejects a missing slug', async () => {
    await expect(runSkill('check_availability', { date: '2026-07-04' })).rejects.toThrow(SkillInputError)
  })

  it('rejects a malformed date', async () => {
    await expect(runSkill('check_availability', { slug: 'sunset', date: '07-04-2026' })).rejects.toThrow(SkillInputError)
  })

  it('rejects an out-of-range guest count', async () => {
    await expect(runSkill('check_availability', { slug: 'sunset', date: '2026-07-04', guests: 0 })).rejects.toThrow(SkillInputError)
    await expect(runSkill('check_availability', { slug: 'sunset', date: '2026-07-04', guests: 51 })).rejects.toThrow(SkillInputError)
  })

  it('translates LISTING_NOT_FOUND into a SkillInputError', async () => {
    h.getFilteredAvailabilityBySlug.mockResolvedValue({ slots: [], reasonCode: 'LISTING_NOT_FOUND' })
    await expect(runSkill('check_availability', { slug: 'missing', date: '2026-07-04' })).rejects.toThrow(SkillInputError)
  })
})
