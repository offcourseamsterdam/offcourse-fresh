import { locales, type Locale } from '@/lib/i18n/config'
import type { ModelContextTool } from './types'

export interface WebMcpDeps {
  locale: Locale
  /** Runs the real, visible homepage search (populates the results section, scrolls to it). */
  triggerHomepageSearch: (date: string, guests: number) => void
  /** Navigates the browser — e.g. router.push from next/navigation. */
  navigate: (url: string) => void
  /** Injectable for tests; defaults to the real fetch. */
  fetchImpl?: typeof fetch
}

interface SearchApiListing {
  slug: string
  title: string
  price_display: string | null
}
interface SearchApiResult {
  listing: SearchApiListing
  availableSlots: unknown[]
}

function buildCruiseUrl(locale: Locale, slug: string, date?: string, guests?: number): string {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (guests) params.set('guests', String(guests))
  const qs = params.toString()
  return `/${locale}/cruises/${slug}${qs ? `?${qs}` : ''}`
}

/**
 * Builds the WebMCP tools this site exposes to an in-browser agent, per
 * https://webmachinelearning.github.io/webmcp/. Pure factory (no DOM/global
 * access) so it's unit-testable — the React component in
 * src/components/agent/WebMcpTools.tsx just wires these up to
 * navigator.modelContext.registerTool().
 */
export function buildWebMcpTools(deps: WebMcpDeps): ModelContextTool[] {
  const { locale, triggerHomepageSearch, navigate } = deps
  const fetchImpl = deps.fetchImpl ?? fetch

  return [
    {
      name: 'search_cruises',
      description:
        "Searches Off Course Amsterdam's canal cruises for a date and guest count, and shows the matching results on the current page.",
      inputSchema: {
        type: 'object',
        properties: {
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD' },
          guests: { type: 'integer', minimum: 1, maximum: 50, description: 'Defaults to 2.' },
        },
        required: ['date'],
      },
      annotations: { readOnlyHint: true },
      execute: async (input, { signal } = {}) => {
        const { date, guests: rawGuests } = input as { date?: unknown; guests?: unknown }
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return { error: '"date" is required and must be YYYY-MM-DD' }
        }
        const guests = typeof rawGuests === 'number' ? rawGuests : 2

        // Real, visible side effect — the same action a visitor triggers by clicking Search.
        triggerHomepageSearch(date, guests)

        const res = await fetchImpl(`/api/search?date=${date}&guests=${guests}`, { signal })
        const json = await res.json()
        if (!json.ok) return { error: json.error ?? 'Search failed' }

        const results = (json.data?.results ?? []) as SearchApiResult[]
        return {
          date,
          guests,
          cruises: results.map((r) => ({
            slug: r.listing.slug,
            title: r.listing.title,
            price_display: r.listing.price_display,
            available_slot_count: r.availableSlots.length,
          })),
        }
      },
    },
    {
      name: 'get_cruise_details',
      description: 'Gets full detail for one Off Course Amsterdam cruise: description, rates, highlights, and FAQs.',
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Cruise slug, from search_cruises.' },
        },
        required: ['slug'],
      },
      annotations: { readOnlyHint: true },
      execute: async (input, { signal } = {}) => {
        const { slug } = input as { slug?: unknown }
        if (typeof slug !== 'string' || !slug) return { error: '"slug" is required' }

        const res = await fetchImpl(`/api/v1/cruises/${encodeURIComponent(slug)}?locale=${locale}`, { signal })
        const json = await res.json()
        return json.ok ? json.data : { error: json.error ?? 'Cruise not found' }
      },
    },
    {
      name: 'navigate_to_cruise',
      description: "Navigates the browser to one cruise's page, optionally pre-filling a date and guest count.",
      inputSchema: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          guests: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['slug'],
      },
      annotations: { readOnlyHint: true },
      execute: (input) => {
        const { slug, date, guests } = input as { slug?: unknown; date?: unknown; guests?: unknown }
        if (typeof slug !== 'string' || !slug) return { error: '"slug" is required' }

        const url = buildCruiseUrl(
          locale,
          slug,
          typeof date === 'string' ? date : undefined,
          typeof guests === 'number' ? guests : undefined
        )
        navigate(url)
        return { navigated: true, url }
      },
    },
  ]
}

export function resolveLocaleFromPathname(pathname: string): Locale {
  const match = pathname.match(/^\/([a-z]{2})(\/|$)/)
  const candidate = match?.[1]
  return (locales as readonly string[]).includes(candidate ?? '') ? (candidate as Locale) : 'en'
}
