import { describe, it, expect } from 'vitest'
import { showLightFestivalPill, isLightFestivalListing, pinnedArtworks, pickBoatPhotos, foodTabFor, boatExtrasFor, CURACAO_PHOTOS, LIGHT_FESTIVAL_ARTWORKS } from './light-festival'

describe('isLightFestivalListing', () => {
  it('matches the private Light Festival listing', () => {
    expect(isLightFestivalListing('amsterdam-light-festival-private-cruise')).toBe(true)
  })

  it('does not theme other listings', () => {
    expect(isLightFestivalListing('amsterdam-light-festival-shared-expat-cruise')).toBe(false)
    expect(isLightFestivalListing('pride-amsterdam-2026')).toBe(false)
  })

  it('handles empty input', () => {
    expect(isLightFestivalListing(null)).toBe(false)
    expect(isLightFestivalListing(undefined)).toBe(false)
    expect(isLightFestivalListing('')).toBe(false)
  })
})

describe('pinnedArtworks', () => {
  it('numbers pins by position in the full artwork list', () => {
    const pins = pinnedArtworks([
      { alt: 'a', imageUrl: 'x', pinColor: '#111' },
      { alt: 'b', imageUrl: 'x' },
      { alt: 'c', imageUrl: 'x', pinColor: '#222' },
    ])
    expect(pins.map(p => [p.alt, p.number])).toEqual([['a', 1], ['c', 3]])
  })

  it('returns nothing when no artwork has a pin', () => {
    expect(pinnedArtworks([{ alt: 'a', imageUrl: 'x' }])).toEqual([])
    expect(pinnedArtworks([])).toEqual([])
  })

  it('keeps the map to the five pin positions it has room for', () => {
    expect(pinnedArtworks(LIGHT_FESTIVAL_ARTWORKS).length).toBeLessThanOrEqual(5)
  })
})

describe('pickBoatPhotos', () => {
  const imgs = [{ url: 'a/x-aaa.webp' }, { url: 'a/x-bbb.webp' }, { url: 'a/x-ccc.mp4' }]

  it('returns matches in key order, not gallery order', () => {
    expect(pickBoatPhotos(imgs, ['bbb', 'aaa']).map(i => i.url)).toEqual(['a/x-bbb.webp', 'a/x-aaa.webp'])
  })
  it('skips keys with no match instead of failing', () => {
    expect(pickBoatPhotos(imgs, ['zzz', 'aaa']).map(i => i.url)).toEqual(['a/x-aaa.webp'])
  })
  it('returns nothing for an empty gallery', () => {
    expect(pickBoatPhotos([], ['aaa'])).toEqual([])
  })
})

describe('foodTabFor', () => {
  it('puts platters and boxes under snacks', () => {
    for (const n of ['Cheese Platter', 'Bites Box Medium (3-4 guests)', 'Fruit Platter', 'Charcuterie Platter']) {
      expect(foodTabFor(n)).toBe('snacks')
    }
  })
  it('puts full meals under lunch & dinner', () => {
    for (const n of ['Brunch', 'Jamaican Buffet', 'Dinner on board', 'lunch box']) {
      expect(foodTabFor(n)).toBe('meals')
    }
  })
  it('does not match meal words inside other words', () => {
    expect(foodTabFor('Mealworm crisps')).toBe('snacks')
  })
})

describe('boatExtrasFor', () => {
  const imgs = [{ url: 'x/p0gw8tf.webp', alt_text: 'cushions' }, { url: 'x/other.webp' }]

  it('gives Diana her evening photos and no dinner note', () => {
    const e = boatExtrasFor('Diana', imgs)!
    expect(e.photos.map(p => p.url)).toEqual(['x/p0gw8tf.webp'])
    expect(e.note).toBeUndefined()
  })
  it('gives Curaçao her own photos plus the dinner-only note', () => {
    const e = boatExtrasFor('Curaçao', imgs)!
    expect(e.photos).toBe(CURACAO_PHOTOS)
    expect(e.note?.href).toBe('/cruises/curacao-jamaican-buffet-cruise')
  })
  it('returns null for an unknown boat', () => {
    expect(boatExtrasFor('Titanic', imgs)).toBeNull()
  })
})

describe('showLightFestivalPill', () => {
  it('shows before and during the festival, including the last night', () => {
    expect(showLightFestivalPill('2026-10-02')).toBe(true)
    expect(showLightFestivalPill('2026-12-12')).toBe(true)
    expect(showLightFestivalPill('2027-01-17')).toBe(true)
  })
  it('hides once the festival is over', () => {
    expect(showLightFestivalPill('2027-01-18')).toBe(false)
  })
})
