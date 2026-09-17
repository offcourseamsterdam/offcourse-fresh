import type { AdminSupabase, SearchSource } from './sources/types'
import type { PaletteItem, PaletteScope } from './types'
import { ALL_SOURCES } from './sources'

/** Below this, matches are too noisy to be worth a database round trip per source. */
const MIN_QUERY_LENGTH = 2
const DEFAULT_SOURCE_TIMEOUT_MS = 800

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(fallback), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      () => { clearTimeout(timer); resolve(fallback) }, // a source should never throw, but a fan-out this wide gets a backstop anyway
    )
  })
}

export interface RunSearchResult {
  items: PaletteItem[]
  /** Group names whose source timed out or threw — shown as a soft "some results may be missing", never an error. */
  failedGroups: string[]
}

/**
 * Runs every applicable source in parallel with `Promise.allSettled` and a
 * per-source timeout, so one slow or broken finance table never blanks the
 * whole palette — the specific bug flagged in this plan's design review
 * (Engineer A's plan used `Promise.all`, which fails everything on one
 * rejection; this is why it doesn't).
 */
export async function runSearch(
  supabase: AdminSupabase,
  query: string,
  scope: PaletteScope | null,
  opts: { sources?: SearchSource[]; timeoutMs?: number } = {},
): Promise<RunSearchResult> {
  if (query.trim().length < MIN_QUERY_LENGTH) return { items: [], failedGroups: [] }

  const sources = opts.sources ?? ALL_SOURCES
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS
  const applicable = scope ? sources.filter(s => s.scope === scope) : sources

  const settled = await Promise.allSettled(
    applicable.map(source =>
      withTimeout(source.search(supabase, query), timeoutMs, null as PaletteItem[] | null)
        .then(items => ({ group: source.group, items }))
    )
  )

  const items: PaletteItem[] = []
  const failedGroups = new Set<string>()
  for (const result of settled) {
    if (result.status === 'fulfilled' && result.value.items) {
      items.push(...result.value.items)
    } else {
      const group = result.status === 'fulfilled' ? result.value.group : 'unknown'
      failedGroups.add(group)
    }
  }
  return { items, failedGroups: [...failedGroups] }
}
