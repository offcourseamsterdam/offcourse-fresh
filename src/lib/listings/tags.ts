import { z } from 'zod'

// Controlled vocabulary for listing + image tagging.
// Single source of truth — used by:
//   - The Gemini image-tagging prompt (extends generate-image-metadata.ts)
//   - The listing scaffolder's tag-suggester
//   - The public /cruises filter UI
//   - The image ranker (rank-images.ts)
//
// To add a tag: append it to the relevant category here and run the image
// backfill script so existing photos can be re-classified.

export const TAG_CATEGORIES = {
  audience: ['couples', 'families', 'elderly', 'expats'],
  time: ['morning', 'afternoon', 'sunset', 'evening'],
  setting: ['central-canals', 'jordaan', 'westerpark', 'quiet-canals', 'wide-canal'],
  mood: ['intimate', 'social', 'quiet', 'lively', 'romantic', 'playful'],
  boat: ['diana', 'curacao'],
  booking: ['private', 'shared'],
  package: [
    'wedding',
    'champagne-breakfast',
    'dinner',
    'birthday-party',
    'bachelorette',
    'corporate-event',
    'proposal',
  ],
} as const

export type TagCategory = keyof typeof TAG_CATEGORIES

export type AudienceTag = (typeof TAG_CATEGORIES.audience)[number]
export type TimeTag = (typeof TAG_CATEGORIES.time)[number]
export type SettingTag = (typeof TAG_CATEGORIES.setting)[number]
export type MoodTag = (typeof TAG_CATEGORIES.mood)[number]
export type BoatTag = (typeof TAG_CATEGORIES.boat)[number]
export type BookingTag = (typeof TAG_CATEGORIES.booking)[number]
export type PackageTag = (typeof TAG_CATEGORIES.package)[number]

export type Tag = AudienceTag | TimeTag | SettingTag | MoodTag | BoatTag | BookingTag | PackageTag

export const ALL_TAGS: readonly Tag[] = Object.values(TAG_CATEGORIES).flat() as Tag[]

const TAG_TO_CATEGORY: Record<string, TagCategory> = Object.fromEntries(
  Object.entries(TAG_CATEGORIES).flatMap(([cat, tags]) =>
    tags.map((t) => [t, cat as TagCategory] as const)
  )
)

export function isValidTag(value: string): value is Tag {
  return value in TAG_TO_CATEGORY
}

export function getTagCategory(tag: Tag): TagCategory {
  return TAG_TO_CATEGORY[tag]
}

export function tagsByCategory(tags: readonly Tag[]): Record<TagCategory, Tag[]> {
  const out = {
    audience: [],
    time: [],
    setting: [],
    mood: [],
    boat: [],
    booking: [],
    package: [],
  } as Record<TagCategory, Tag[]>
  for (const t of tags) {
    out[getTagCategory(t)].push(t)
  }
  return out
}

export const TagSchema = z.enum(ALL_TAGS as [Tag, ...Tag[]])
export const TagArraySchema = z.array(TagSchema)
