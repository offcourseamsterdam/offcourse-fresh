import { getFareHarborClient } from './client'
import { buildTypeMapFromAvailabilities } from './config'
import {
  applyAllFilters,
  getValidTimeSlots,
  getTimeFromISO,
  type ListingFilterConfig,
} from './filters'
import { transformToSlot, applyCutoff } from './availability'
import { createAdminClient } from '@/lib/supabase/admin'
import { locales } from '@/lib/i18n/config'
import { revalidatePath } from 'next/cache'
import type { FHMinimalAvailability } from './types'

export interface UpcomingDaySlot {
  startTime: string // "HH:MM", e.g. "14:00"
  endTime: string   // "HH:MM", e.g. "15:30"
  startIso: string  // "2026-09-10T14:00:00+02:00" (ISO with Amsterdam timezone)
  boat: string
  availableCapacity: number
  totalCapacity: number
  deepLink: string  // "/cruises/classic-boat-tour?date=2026-09-10&time=14:00"
}

export interface UpcomingDay {
  date: string // "YYYY-MM-DD"
  dayOfWeek: string // e.g. "Thursday"
  formattedDate: string // e.g. "Thursday 10 September"
  slots: UpcomingDaySlot[]
}

export interface ScheduleSummary {
  category: 'private' | 'shared'
  typicalStartTime: string
  typicalEndTime: string
  operatingDays: number[]
  cateringCutoffHours: number | null
}

export interface CruiseAvailabilitySnapshot {
  listing_id: string
  fareharbor_item_pk: number
  category: 'private' | 'shared'
  next_available_slot: string | null
  upcoming_days: UpcomingDay[]
  schedule_summary: ScheduleSummary
  snapshot_at: string
  raw_availability_window_days: number
}

interface ListingRow {
  id: string
  slug: string
  title: string
  category: string
  fareharbor_item_pk: number
  allowed_resource_pks: number[] | null
  allowed_customer_type_pks: number[] | null
  availability_filters: unknown
  booking_cutoff_hours: number | null
  max_guests: number | null
  starting_price: number | null
}

interface FareHarborItemRow {
  id: string
  fareharbor_pk: number
  name: string
  item_type: string
  resources: unknown
  booking_cutoff_hours: number | null
  max_slot_capacity: number | null
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

function getAmsToday(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date()).split('-')
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
}

function addDays(baseDate: Date, days: number): Date {
  const result = new Date(baseDate)
  result.setDate(result.getDate() + days)
  return result
}

function formatDateISO(d: Date): string {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseResourceBoatMap(resources: unknown): Map<number, string> {
  const resMap = new Map<number, string>()
  const list = (resources as Array<{ fareharbor_pk: number; name: string }>) ?? []
  for (const r of list) {
    const name = r.name?.toLowerCase() ?? ''
    if (name.includes('diana')) resMap.set(r.fareharbor_pk, 'diana')
    else if (name.includes('curaçao') || name.includes('curacao')) resMap.set(r.fareharbor_pk, 'curacao')
  }
  return resMap
}

/**
 * Project raw FareHarbor availabilities for a single virtual listing according to
 * its allowed customer types, resources, time filters, and cutoffs.
 */
async function projectListingSnapshot({
  listing,
  rawAvails,
  fhItem,
  resourcePkToBoat,
  today,
  daysAhead,
  now,
}: {
  listing: ListingRow
  rawAvails: FHMinimalAvailability[]
  fhItem: FareHarborItemRow | undefined
  resourcePkToBoat: Map<number, string>
  today: Date
  daysAhead: number
  now: Date
}): Promise<CruiseAvailabilitySnapshot> {
  const typeMap = buildTypeMapFromAvailabilities(rawAvails)

  const filterConfig: ListingFilterConfig = {
    allowed_resource_pks: listing.allowed_resource_pks,
    allowed_customer_type_pks: listing.allowed_customer_type_pks,
    availability_filters: listing.availability_filters,
  }

  const effectiveCutoffItem = {
    booking_cutoff_hours: listing.booking_cutoff_hours ?? fhItem?.booking_cutoff_hours ?? null,
    item_type: fhItem?.item_type ?? null,
    max_slot_capacity: fhItem?.max_slot_capacity ?? listing.max_guests ?? null,
  }

  // Group raw availabilities by date string (YYYY-MM-DD)
  const dateMap = new Map<string, FHMinimalAvailability[]>()
  for (let d = 0; d < daysAhead; d++) {
    const dateStr = formatDateISO(addDays(today, d))
    dateMap.set(dateStr, [])
  }
  for (const a of rawAvails) {
    const aDate = a.start_at.slice(0, 10)
    if (dateMap.has(aDate)) {
      dateMap.get(aDate)!.push(a)
    }
  }

  const testPartySize = 2
  const upcomingDays: UpcomingDay[] = []
  const allSlotsIso: string[] = []
  const operatingDaysSet = new Set<number>()
  const timesSeen: string[] = []

  for (const [dateStr, dateAvails] of dateMap.entries()) {
    if (dateAvails.length === 0) continue

    const dateObj = new Date(dateStr + 'T00:00:00')
    const filtered = await applyAllFilters(
      dateAvails,
      filterConfig,
      testPartySize,
      dateObj,
      typeMap,
      resourcePkToBoat
    )

    const valid = getValidTimeSlots(filtered, testPartySize, typeMap)
    if (valid.length === 0) continue

    const slots = valid.map(a => transformToSlot(a, typeMap))
    const withCutoff = applyCutoff(slots, effectiveCutoffItem, now)
    const bookable = withCutoff.filter(s => !s.callToBook && s.capacity > 0)

    if (bookable.length === 0) continue

    const dayOfWeekIdx = dateObj.getDay()
    operatingDaysSet.add(dayOfWeekIdx)

    const daySlots: UpcomingDaySlot[] = bookable.slice(0, 4).map(slot => {
      const boatName = slot.customerTypes[0]?.boatId || 'curacao'
      const timeStr = getTimeFromISO(slot.startAt)
      timesSeen.push(timeStr)
      allSlotsIso.push(slot.startAt)

      return {
        startTime: timeStr,
        endTime: getTimeFromISO(slot.endAt),
        startIso: slot.startAt,
        boat: boatName,
        availableCapacity: slot.capacity,
        totalCapacity: slot.customerTypes[0]?.totalCapacity ?? slot.capacity,
        deepLink: `/cruises/${listing.slug}?date=${dateStr}&time=${encodeURIComponent(slot.startTime)}`,
      }
    })

    if (upcomingDays.length < 5) {
      const dayName = DAY_NAMES[dayOfWeekIdx]
      const formattedDate = `${dayName} ${dateObj.getDate()} ${MONTH_NAMES[dateObj.getMonth()]}`
      upcomingDays.push({
        date: dateStr,
        dayOfWeek: dayName,
        formattedDate,
        slots: daySlots,
      })
    }
  }

  timesSeen.sort()
  const typicalStartTime = timesSeen[0] ?? '11:00'
  const typicalEndTime = timesSeen[timesSeen.length - 1] ?? '21:30'
  const nextAvailableSlot = allSlotsIso.length > 0 ? allSlotsIso[0] : null

  return {
    listing_id: listing.id,
    fareharbor_item_pk: listing.fareharbor_item_pk,
    category: listing.category as 'private' | 'shared',
    next_available_slot: nextAvailableSlot,
    upcoming_days: upcomingDays,
    schedule_summary: {
      category: listing.category as 'private' | 'shared',
      typicalStartTime,
      typicalEndTime,
      operatingDays: Array.from(operatingDaysSet).sort(),
      cateringCutoffHours: effectiveCutoffItem.booking_cutoff_hours,
    },
    snapshot_at: now.toISOString(),
    raw_availability_window_days: daysAhead,
  }
}

/**
 * Synchronizes upcoming availability for all published cruise listings from
 * FareHarbor and stores a compact, structured snapshot per listing in Supabase.
 *
 * Architecture highlights:
 * - Concurrently queries FareHarbor for the parent items (Private & Shared) in 2 x 7-day
 *   date range blocks via Promise.allSettled.
 * - Projects each virtual listing's specific availability (boats, cutoffs, time windows).
 * - Stores structured JSONB with absolute ISO timestamps to prevent LLM date hallucinations.
 * - Revalidates all cruise pages across all locales.
 */
export async function syncAllCruisesAvailability(daysAhead = 14) {
  const supabase = createAdminClient()
  const client = getFareHarborClient()
  const now = new Date()

  // 1. Fetch active FareHarbor items (Private and Shared)
  const { data: fhItems, error: fhItemsError } = await supabase
    .from('fareharbor_items')
    .select('id, fareharbor_pk, name, item_type, resources, booking_cutoff_hours, max_slot_capacity')
    .eq('is_active', true)

  if (fhItemsError || !fhItems || fhItems.length === 0) {
    throw new Error(`Failed to fetch fareharbor items: ${fhItemsError?.message ?? 'none found'}`)
  }

  // 2. Compute date windows: 2 blocks of 7 days (daysAhead = 14)
  const today = getAmsToday()
  const range1Start = formatDateISO(today)
  const range1End = formatDateISO(addDays(today, 6))
  const range2Start = formatDateISO(addDays(today, 7))
  const range2End = formatDateISO(addDays(today, daysAhead - 1))

  // 3. Query FareHarbor for all items and date ranges concurrently
  const itemRawAvails = new Map<number, FHMinimalAvailability[]>()
  const itemResources = new Map<number, Map<number, string>>()

  await Promise.all(
    (fhItems as FareHarborItemRow[]).map(async item => {
      itemResources.set(item.fareharbor_pk, parseResourceBoatMap(item.resources))

      const [res1, res2] = await Promise.allSettled([
        client.getAvailabilitiesDateRange(item.fareharbor_pk, range1Start, range1End),
        client.getAvailabilitiesDateRange(item.fareharbor_pk, range2Start, range2End),
      ])

      const avails1 = res1.status === 'fulfilled' ? res1.value : []
      const avails2 = res2.status === 'fulfilled' ? res2.value : []

      if (res1.status === 'rejected') {
        console.error(`[availability-sync] Range 1 failed for item ${item.fareharbor_pk}:`, res1.reason)
      }
      if (res2.status === 'rejected') {
        console.error(`[availability-sync] Range 2 failed for item ${item.fareharbor_pk}:`, res2.reason)
      }

      itemRawAvails.set(item.fareharbor_pk, [...avails1, ...avails2])
    })
  )

  // 4. Fetch all published cruise listings (the virtual listings)
  const { data: listings, error: listingsError } = await supabase
    .from('cruise_listings')
    .select(`
      id, slug, title, category, fareharbor_item_pk,
      allowed_resource_pks, allowed_customer_type_pks, availability_filters,
      booking_cutoff_hours, max_guests, starting_price
    `)
    .eq('is_published', true)

  if (listingsError || !listings) {
    throw new Error(`Failed to fetch cruise listings: ${listingsError?.message ?? 'none found'}`)
  }

  const updatedSlugs: string[] = []
  const snapshotsToUpsert: CruiseAvailabilitySnapshot[] = []

  // 5. Project the availability per virtual listing
  for (const listing of listings as ListingRow[]) {
    const rawAvails = itemRawAvails.get(listing.fareharbor_item_pk) ?? []
    const fhItem = (fhItems as FareHarborItemRow[]).find(i => i.fareharbor_pk === listing.fareharbor_item_pk)
    const resourcePkToBoat = itemResources.get(listing.fareharbor_item_pk) ?? new Map()

    const snapshot = await projectListingSnapshot({
      listing,
      rawAvails,
      fhItem,
      resourcePkToBoat,
      today,
      daysAhead,
      now,
    })

    snapshotsToUpsert.push(snapshot)
    updatedSlugs.push(listing.slug)
  }

  // 6. Upsert all snapshots to Supabase
  if (snapshotsToUpsert.length > 0) {
    const { error: upsertErr } = await (supabase
      .from('cruise_availability_snapshots') as any)
      .upsert(snapshotsToUpsert, { onConflict: 'listing_id' })

    if (upsertErr) {
      console.error('[availability-sync] Upsert error:', upsertErr)
      throw new Error(`Failed to upsert availability snapshots: ${upsertErr.message}`)
    }
  }

  // 7. Purge Next.js page cache across all locales
  try {
    for (const locale of locales) {
      revalidatePath(`/${locale}/cruises`)
      for (const slug of updatedSlugs) {
        revalidatePath(`/${locale}/cruises/${slug}`)
      }
    }
  } catch (err) {
    console.warn('[availability-sync] revalidatePath warning (ignored):', err)
  }

  return {
    success: true,
    syncedListingsCount: snapshotsToUpsert.length,
    updatedSlugs,
    syncedAt: now.toISOString(),
  }
}
