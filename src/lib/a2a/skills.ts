import { getPublicCruiseList } from '@/lib/cruise/get-public-cruise-list'
import { getFilteredAvailabilityBySlug } from '@/lib/fareharbor/availability'
import { locales, defaultLocale, type Locale } from '@/lib/i18n/config'

export const SKILL_IDS = ['list_cruises', 'check_availability'] as const
export type SkillId = (typeof SKILL_IDS)[number]

export function isSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && (SKILL_IDS as readonly string[]).includes(value)
}

/** Thrown for a skill input that's syntactically present but semantically wrong (e.g. a bad date format). */
export class SkillInputError extends Error {}

function resolveLocale(input: unknown): Locale {
  return (locales as readonly string[]).includes(input as string) ? (input as Locale) : defaultLocale
}

async function runListCruises(input: unknown) {
  const locale = resolveLocale((input as { locale?: unknown } | undefined)?.locale)
  const cruises = await getPublicCruiseList(locale)
  return {
    cruises: cruises.map((c) => ({
      slug: c.slug,
      title: c.title,
      tagline: c.tagline,
      category: c.category,
      price_display: c.priceDisplay,
      starting_price: c.startingPrice,
      duration_display: c.durationDisplay,
      max_guests: c.maxGuests,
    })),
  }
}

async function runCheckAvailability(input: unknown) {
  const { slug, date, guests } = (input ?? {}) as { slug?: unknown; date?: unknown; guests?: unknown }

  if (typeof slug !== 'string' || !slug) {
    throw new SkillInputError('"slug" is required')
  }
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new SkillInputError('"date" is required and must be YYYY-MM-DD')
  }
  const guestCount = typeof guests === 'number' ? guests : 2
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 50) {
    throw new SkillInputError('"guests" must be an integer between 1 and 50')
  }

  const { slots, reasonCode } = await getFilteredAvailabilityBySlug(slug, date, guestCount)
  if (reasonCode === 'LISTING_NOT_FOUND') {
    throw new SkillInputError(`No cruise found with slug "${slug}"`)
  }

  return {
    slug,
    date,
    guests: guestCount,
    reasonCode,
    slots: slots.map((s) => ({
      startTime: s.startTime,
      startAt: s.startAt,
      endAt: s.endAt,
      headline: s.headline,
      capacity: s.capacity,
    })),
  }
}

/**
 * Runs one of the two skills this agent supports. Throws {@link SkillInputError}
 * for bad input (maps to a REJECTED task in the A2A handler) — anything else
 * thrown is an unexpected failure (maps to a FAILED task).
 */
export async function runSkill(skillId: SkillId, input: unknown): Promise<unknown> {
  switch (skillId) {
    case 'list_cruises':
      return runListCruises(input)
    case 'check_availability':
      return runCheckAvailability(input)
  }
}
