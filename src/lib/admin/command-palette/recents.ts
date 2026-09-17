import type { PaletteItem } from './types'

/**
 * Minimal storage shape the rest of this file needs — lets tests pass a
 * plain in-memory fake instead of needing a jsdom `localStorage` (this repo's
 * Vitest environment is `node`, not `jsdom` — see vitest.config.ts).
 */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'admin:command-palette-recents'
const MAX_ITEMS = 20
const MAX_VISITS_PER_ITEM = 10

export interface RecentEntry {
  item: PaletteItem
  /** Up to the last MAX_VISITS_PER_ITEM open times, newest first (epoch ms). */
  visits: number[]
}

function getDefaultStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    // Private browsing / blocked storage can throw just accessing the property.
    return null
  }
}

/** Never throws — recents are a convenience, not something the palette depends on to work. */
export function loadRecents(storage: KeyValueStorage | null = getDefaultStorage()): RecentEntry[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
  }
}

/** Records that `item` was just opened. Never throws. */
export function recordVisit(
  item: PaletteItem,
  now: number = Date.now(),
  storage: KeyValueStorage | null = getDefaultStorage(),
): void {
  if (!storage) return
  try {
    const entries = loadRecents(storage)
    const idx = entries.findIndex(e => e.item.id === item.id)
    if (idx >= 0) {
      entries[idx] = {
        item, // refresh the snapshot (title/subtitle may have changed since last visit)
        visits: [now, ...entries[idx].visits].slice(0, MAX_VISITS_PER_ITEM),
      }
      // Move the just-visited item to the front so a tie in score still favors it.
      entries.unshift(entries.splice(idx, 1)[0])
    } else {
      entries.unshift({ item, visits: [now] })
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ITEMS)))
  } catch {
    // Quota exceeded, storage disabled mid-session, etc. — swallow, same as loadRecents.
  }
}

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

/**
 * Slack's Quick Switcher frecency: each recorded visit earns points from
 * which time bucket it falls into, summed across all recorded visits, then
 * divided by how many visits were recorded (capped — here, by MAX_VISITS_PER_ITEM,
 * since that's the most we ever store) — so an item visited many times but
 * long ago decays, while a handful of very recent visits still ranks high.
 */
function recencyPoints(ageMs: number): number {
  if (ageMs <= 4 * HOUR_MS) return 100
  if (ageMs <= DAY_MS) return 80
  if (ageMs <= 3 * DAY_MS) return 60
  if (ageMs <= 7 * DAY_MS) return 40
  if (ageMs <= 30 * DAY_MS) return 20
  if (ageMs <= 90 * DAY_MS) return 10
  return 0
}

export function frecencyScore(entry: RecentEntry, now: number = Date.now()): number {
  if (entry.visits.length === 0) return 0
  const total = entry.visits.reduce((sum, t) => sum + recencyPoints(now - t), 0)
  return total / entry.visits.length
}

/** The recents list as shown in the palette's empty state, best-first. */
export function topRecents(
  limit: number,
  now: number = Date.now(),
  storage: KeyValueStorage | null = getDefaultStorage(),
): RecentEntry[] {
  return loadRecents(storage)
    .map(entry => ({ entry, score: frecencyScore(entry, now) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry }) => entry)
}
