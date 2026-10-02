// Amsterdam Light Festival theme — a per-listing page skin (like the Pride rainbow
// theme in cruises/[slug]/page.tsx), switched on by slug. The booking flow,
// pricing and data are untouched; only presentation changes:
//   full-bleed snowy hero photo with the headline + illustrated route map,
//   a "What you'll see" artworks section, a dark indigo booking widget, and a
//   date scroller that starts on the first festival night.

export const LIGHT_FESTIVAL_SLUGS = new Set(['amsterdam-light-festival-private-cruise'])

/**
 * The illustrated route map in the hero is hidden until the Edition 15 line-up
 * is known (its pins are the artworks). Flip to true to bring it back.
 */
export const LIGHT_FESTIVAL_SHOW_ROUTE_MAP = false

/** First festival night — the booking date scroller starts here until then. */
export const LIGHT_FESTIVAL_START_DATE = '2026-11-26'

export function isLightFestivalListing(slug: string | null | undefined): boolean {
  return !!slug && LIGHT_FESTIVAL_SLUGS.has(slug)
}

export interface LightFestivalArtwork {
  /** Plain description for screen readers. Deliberately no invented titles or artists. */
  alt: string
  imageUrl: string
  /** Pin colour on the route map; artworks without a colour aren't pinned. */
  pinColor?: string
}

/** Artworks on the full festival route, as shown on the page. */
export const LIGHT_FESTIVAL_TOTAL_ARTWORKS = 20

/** Boat photo on the closing "And N more on our route" card (Diana under a lit bridge). */
export const LIGHT_FESTIVAL_MORE_CARD_IMAGE = 'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/518dfaf2-c912-4f2f-9a0f-1685caf4d862-1760444608522-vep80r.webp'

export const LIGHT_FESTIVAL_ARTWORKS: LightFestivalArtwork[] = [
  { alt: 'Light artwork', imageUrl: '/images/light-festival/artworks/artwork-1.jpg', pinColor: '#bf5af2' },
  { alt: 'Light artwork', imageUrl: '/images/light-festival/artworks/artwork-2.jpg', pinColor: '#fec201' },
  { alt: 'Light artwork', imageUrl: '/images/light-festival/artworks/artwork-3.jpg', pinColor: '#00d2ff' },
  { alt: 'Light artwork', imageUrl: '/images/light-festival/artworks/artwork-4.png', pinColor: '#30d158' },
  { alt: 'Light artwork', imageUrl: '/images/light-festival/artworks/artwork-5.png', pinColor: '#ff3b30' },
]

/** Where the official line-up will appear — linked from the "coming soon" note. */
export const LIGHT_FESTIVAL_EDITION_URL = 'https://amsterdamlightfestival.com/en/edition-15'

// Photo galleries shown inside each boat card, matched by the unique tail of
// the file name so a photo still matches if its storage prefix ever changes.
// Diana: evening shots from this listing's own gallery (no daytime photos).
export const LIGHT_FESTIVAL_BOAT_PHOTO_KEYS = [
  'p0gw8tf', // yellow cushions, warm canopy lights
  'mou2ij',  // helm + red interior
  'pk5vzk',  // Diana in a lit canal, portrait
  'vep80r',  // Diana under the lit bridge
  '3kgkba',  // Diana at sunset
  '9ps4z8',  // Jannah & Beer
]

const CURACAO_IMG = 'https://fkylzllxvepmrtqxisrn.supabase.co/storage/v1/object/public/cruise-images/_originals'
// Curaçao: her own photos from the Curaçao listing (she has no evening shots yet).
export const CURACAO_PHOTOS: { url: string; alt: string }[] = [
  { url: `${CURACAO_IMG}/704ed5f0-76f0-4b94-9598-6fec37cdfefd/b7d62e96-c71d-46dd-9017-f7e467da616a.png`, alt: 'Curaçao sundeck with cushions' },
  { url: `${CURACAO_IMG}/b6535d5f-f2e3-46c6-a1ad-6d3b494d70ef/a090ce29-7741-4b6d-b57a-65dd435be41c.png`, alt: 'Curaçao canopy and seating' },
  { url: `${CURACAO_IMG}/c419659a-a021-42ef-bfb7-77bde2a0a82a/fcb172f4-c8a4-49f9-adf2-92b5c61b6be9.jpg`, alt: 'Curaçao on the canal' },
  { url: `${CURACAO_IMG}/c419659a-a021-42ef-bfb7-77bde2a0a82a/a4252cbb-a1dc-4ad2-b151-94d4c047d5d4.jpg`, alt: 'Friends toasting on Curaçao' },
  { url: `${CURACAO_IMG}/c419659a-a021-42ef-bfb7-77bde2a0a82a/375dac24-5cb4-46e7-99f0-149c7422038f.jpg`, alt: 'Drinks and snacks on the table' },
  { url: `${CURACAO_IMG}/c419659a-a021-42ef-bfb7-77bde2a0a82a/6f267227-6e5a-4566-b105-9fe8c0d0e646.jpg`, alt: 'Table with bites and bubbles' },
]

/** Dinner only runs on Curaçao — shown on her card, linking to the buffet cruise. */
export const CURACAO_DINNER_NOTE = {
  label: 'Dinner cruises: Curaçao only',
  detail: 'Sit-down dinners happen on Curaçao, like our Jamaican Buffet Cruise. Diana is for drinks and snacks.',
  linkLabel: 'See the Jamaican Buffet Cruise',
  href: '/cruises/curacao-jamaican-buffet-cruise',
}

export type BoatExtras = { photos: { url: string; alt: string }[]; note?: typeof CURACAO_DINNER_NOTE }

/** Pick the boat photos out of a listing's gallery, in the order above. */
export function pickBoatPhotos<T extends { url: string }>(images: T[], keys: string[] = LIGHT_FESTIVAL_BOAT_PHOTO_KEYS): T[] {
  return keys.flatMap(key => images.filter(img => img.url.includes(key)).slice(0, 1))
}

export type FoodTab = 'snacks' | 'meals'

/**
 * Which tab a food extra belongs under: full meals (brunch, lunch, dinner,
 * buffets) go under "Lunch & dinner", everything else (bites boxes, platters,
 * fruit) under "Snacks". Matched on the name so a new extra lands in the right
 * tab without a schema change.
 */
export function foodTabFor(name: string): FoodTab {
  return /\b(brunch|lunch|dinner|breakfast|buffet|meal)\b/i.test(name) ? 'meals' : 'snacks'
}

/** Artworks that get a numbered pin on the map, in route order. */
export function pinnedArtworks(artworks: LightFestivalArtwork[] = LIGHT_FESTIVAL_ARTWORKS) {
  return artworks
    .map((a, i) => ({ ...a, number: i + 1 }))
    .filter((a): a is LightFestivalArtwork & { number: number; pinColor: string } => !!a.pinColor)
}

/**
 * Extra content for a boat's card on the Light Festival page: its photo gallery
 * and, for Curaçao, the dinner note. `listingImages` supplies Diana's evening photos.
 */
export function boatExtrasFor(boatName: string, listingImages: { url: string; alt_text?: string | null }[]): BoatExtras | null {
  const name = boatName.toLowerCase()
  if (name.includes('diana')) {
    return { photos: pickBoatPhotos(listingImages).map(i => ({ url: i.url, alt: i.alt_text || 'Diana' })) }
  }
  if (name.includes('cura')) return { photos: CURACAO_PHOTOS, note: CURACAO_DINNER_NOTE }
  return null
}
