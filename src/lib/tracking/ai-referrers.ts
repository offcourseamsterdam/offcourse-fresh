// Classify a session's referrer as coming from an AI assistant / answer engine.
//
// When an LLM (ChatGPT, Perplexity, Gemini, …) cites Off Course and the user
// clicks through, the browser sends that engine's host as the referrer. This is
// the ONLY first-party signal we have for "AI citations" — the Google Ads API
// knows nothing about it. Pure + table-driven so it's a single source of truth
// (the API route builds its SQL filter from AI_REFERRER_HOSTS) and easy to test.
//
// Known limitation: Google's AI Overviews / AI Mode appear under the normal
// `google.com` referrer, so they can't be separated from organic Google here.

export interface AiEngine {
  key: string
  label: string
}

export interface AiEngineDef extends AiEngine {
  /** Referrer hostnames (without leading www.) that map to this engine. */
  hosts: string[]
  /** utm_source or detail aliases (lowercase) */
  utmSources: string[]
  /** Direct homepage / app link */
  testUrl: string
  /** Direct prompt query URL generator */
  searchUrl: (query?: string) => string
}

export const DEFAULT_AI_SEARCH_QUERY = 'Wat zijn de beste boutique salonboot rondvaarten in Amsterdam?'

export const AI_ENGINES: AiEngineDef[] = [
  {
    key: 'chatgpt',
    label: 'ChatGPT',
    hosts: ['chatgpt.com', 'chat.openai.com'],
    utmSources: ['chatgpt.com', 'chatgpt', 'openai', 'chat.openai.com'],
    testUrl: 'https://chatgpt.com/',
    searchUrl: (q = DEFAULT_AI_SEARCH_QUERY) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`,
  },
  {
    key: 'perplexity',
    label: 'Perplexity',
    hosts: ['perplexity.ai'],
    utmSources: ['perplexity.ai', 'perplexity'],
    testUrl: 'https://www.perplexity.ai/',
    searchUrl: (q = DEFAULT_AI_SEARCH_QUERY) => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`,
  },
  {
    key: 'gemini',
    label: 'Gemini',
    hosts: ['gemini.google.com', 'bard.google.com'],
    utmSources: ['gemini.google.com', 'gemini', 'bard.google.com', 'bard'],
    testUrl: 'https://gemini.google.com/app',
    searchUrl: () => `https://gemini.google.com/app`,
  },
  {
    key: 'claude',
    label: 'Claude',
    hosts: ['claude.ai'],
    utmSources: ['claude.ai', 'claude', 'anthropic'],
    testUrl: 'https://claude.ai/',
    searchUrl: (q = DEFAULT_AI_SEARCH_QUERY) => `https://claude.ai/new?q=${encodeURIComponent(q)}`,
  },
  {
    key: 'copilot',
    label: 'Copilot',
    hosts: ['copilot.microsoft.com'],
    utmSources: ['copilot.microsoft.com', 'copilot'],
    testUrl: 'https://copilot.microsoft.com/',
    searchUrl: (q = DEFAULT_AI_SEARCH_QUERY) => `https://copilot.microsoft.com/?q=${encodeURIComponent(q)}`,
  },
  {
    key: 'meta_ai',
    label: 'Meta AI',
    hosts: ['meta.ai'],
    utmSources: ['meta.ai', 'meta_ai'],
    testUrl: 'https://www.meta.ai/',
    searchUrl: () => 'https://www.meta.ai/',
  },
  {
    key: 'deepseek',
    label: 'DeepSeek',
    hosts: ['deepseek.com', 'chat.deepseek.com'],
    utmSources: ['deepseek.com', 'deepseek'],
    testUrl: 'https://chat.deepseek.com/',
    searchUrl: () => 'https://chat.deepseek.com/',
  },
  {
    key: 'grok',
    label: 'Grok',
    hosts: ['grok.com', 'x.ai'],
    utmSources: ['grok.com', 'grok', 'x.ai'],
    testUrl: 'https://grok.com/',
    searchUrl: (q = DEFAULT_AI_SEARCH_QUERY) => `https://grok.com/?q=${encodeURIComponent(q)}`,
  },
  {
    key: 'mistral',
    label: 'Le Chat (Mistral)',
    hosts: ['chat.mistral.ai'],
    utmSources: ['chat.mistral.ai', 'mistral.ai', 'mistral'],
    testUrl: 'https://chat.mistral.ai/',
    searchUrl: () => 'https://chat.mistral.ai/',
  },
  {
    key: 'you',
    label: 'You.com',
    hosts: ['you.com'],
    utmSources: ['you.com', 'you'],
    testUrl: 'https://you.com/',
    searchUrl: (q = DEFAULT_AI_SEARCH_QUERY) => `https://you.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    key: 'poe',
    label: 'Poe',
    hosts: ['poe.com'],
    utmSources: ['poe.com', 'poe'],
    testUrl: 'https://poe.com/',
    searchUrl: (q = DEFAULT_AI_SEARCH_QUERY) => `https://poe.com/search?q=${encodeURIComponent(q)}`,
  },
]

/** Core 4 AI engines always highlighted and present in the dashboard */
export const CORE_AI_ENGINE_KEYS = ['chatgpt', 'perplexity', 'gemini', 'claude'] as const

/** Flat list of every AI host — used to build the SQL pre-filter (one source of truth). */
export const AI_REFERRER_HOSTS: string[] = AI_ENGINES.flatMap(e => e.hosts)

/** Extract a normalized hostname (lower-case, no leading www.) from a referrer URL. */
function hostOf(referrer: string): string | null {
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Extract query param safely from path or full URL */
function extractQueryParam(urlStr: string | null | undefined, param: string): string | null {
  if (!urlStr) return null
  try {
    const parsed = new URL(urlStr, 'https://offcourseamsterdam.com')
    return parsed.searchParams.get(param)
  } catch {
    return null
  }
}

export interface AiClassificationInput {
  referrer?: string | null
  utm_source?: string | null
  entry_page?: string | null
  traffic_detail?: string | null
  traffic_source?: string | null
}

/**
 * Returns the AI engine a session or booking belongs to, or null if it isn't an AI engine.
 * Inspects referrer host, utm_source, entry_page query params, and traffic_detail.
 */
export function classifyAiEngine(input: AiClassificationInput | null | undefined): AiEngine | null {
  if (!input) return null

  // 1. Check direct utm_source or extracted from entry_page / referrer
  const utmParam = extractQueryParam(input.entry_page, 'utm_source') || extractQueryParam(input.referrer, 'utm_source')
  const rawUtm = (input.utm_source || utmParam || '').toLowerCase().trim()
  const rawDetail = (input.traffic_detail || '').toLowerCase().trim()
  const rawSource = (input.traffic_source || '').toLowerCase().trim()
  const refHost = input.referrer ? hostOf(input.referrer) : null

  for (const engine of AI_ENGINES) {
    // Check referrer host
    if (refHost && engine.hosts.some(h => refHost === h || refHost.endsWith(`.${h}`))) {
      return { key: engine.key, label: engine.label }
    }

    // Check utm_source
    if (rawUtm && engine.utmSources.some(u => rawUtm === u || rawUtm.includes(u))) {
      return { key: engine.key, label: engine.label }
    }

    // Check traffic_detail (used in bookings attribution)
    if (rawDetail && (
      engine.utmSources.some(u => rawDetail === u || rawDetail.includes(u)) ||
      engine.hosts.some(h => rawDetail === h || rawDetail.includes(h)) ||
      rawDetail.includes(engine.key)
    )) {
      return { key: engine.key, label: engine.label }
    }

    // Check traffic_source if explicitly 'ai' or engine name
    if (rawSource.includes(engine.key)) {
      return { key: engine.key, label: engine.label }
    }
  }

  return null
}

/** Backward-compatible helper for referrer-only calls */
export function classifyAiReferrer(referrer: string | null | undefined): AiEngine | null {
  return classifyAiEngine({ referrer })
}

/**
 * Detect whether an entry page or referrer URL carries availability parameters (?date=YYYY-MM-DD or ?time=HH:MM).
 * These deep links are generated by our AI-ready structured data & live availability components.
 */
export function isAvailabilityDeepLink(urlStr: string | null | undefined): boolean {
  if (!urlStr) return false
  return /[?&]date=\d{4}-\d{2}-\d{2}/.test(urlStr) || /[?&]time=\d{1,2}:\d{2}/.test(urlStr) || /[?&]time=[^&]+/.test(urlStr)
}

// ── Aggregation (pure) — sessions + bookings per engine ──────────────────────────

export interface AiReferralRow {
  key: string
  label: string
  sessions: number
  visitors: number
  bookings: number
  revenueEuros: number
  availabilitySessions: number
  availabilityBookings: number
  availabilityRevenueEuros: number
  testUrl: string
  searchUrl: string
}

export interface SessionRecord {
  id: string
  visitor_id: string | null
  referrer: string | null
  utm_source?: string | null
  entry_page?: string | null
}

export interface BookingRecord {
  id?: string
  session_id: string | null
  stripe_amount: number | null
  traffic_detail?: string | null
  traffic_source?: string | null
}

export function aggregateAiReferrals(
  sessions: SessionRecord[],
  bookings: BookingRecord[],
  options: { includeCoreEngines?: boolean } = {},
): AiReferralRow[] {
  const sessionEngine = new Map<string, AiEngine>()
  const sessionAvailability = new Map<string, boolean>()

  // Map to hold aggregates
  const byEngine = new Map<
    string,
    {
      label: string
      sessions: number
      visitors: Set<string>
      bookings: number
      revenueCents: number
      availabilitySessions: number
      availabilityBookings: number
      availabilityRevenueCents: number
      testUrl: string
      searchUrl: string
    }
  >()

  // Initialize the core 4 engines if requested so they are present in the table
  if (options.includeCoreEngines) {
    for (const engineKey of CORE_AI_ENGINE_KEYS) {
      const def = AI_ENGINES.find(e => e.key === engineKey)
      if (def) {
        byEngine.set(def.key, {
          label: def.label,
          sessions: 0,
          visitors: new Set(),
          bookings: 0,
          revenueCents: 0,
          availabilitySessions: 0,
          availabilityBookings: 0,
          availabilityRevenueCents: 0,
          testUrl: def.testUrl,
          searchUrl: def.searchUrl(),
        })
      }
    }
  }

  // 1. Process sessions
  for (const s of sessions) {
    const engine = classifyAiEngine(s)
    if (!engine) continue

    sessionEngine.set(s.id, engine)
    const isAvail = isAvailabilityDeepLink(s.entry_page) || isAvailabilityDeepLink(s.referrer)
    sessionAvailability.set(s.id, isAvail)

    let agg = byEngine.get(engine.key)
    if (!agg) {
      const def = AI_ENGINES.find(e => e.key === engine.key)
      agg = {
        label: engine.label,
        sessions: 0,
        visitors: new Set(),
        bookings: 0,
        revenueCents: 0,
        availabilitySessions: 0,
        availabilityBookings: 0,
        availabilityRevenueCents: 0,
        testUrl: def?.testUrl ?? `https://${engine.key}.com`,
        searchUrl: def?.searchUrl() ?? `https://${engine.key}.com`,
      }
      byEngine.set(engine.key, agg)
    }

    agg.sessions++
    if (isAvail) agg.availabilitySessions++
    if (s.visitor_id && !s.visitor_id.startsWith('anon_')) {
      agg.visitors.add(s.visitor_id)
    }
  }

  // 2. Process bookings (attribute by session_id OR direct traffic_detail/traffic_source)
  for (const b of bookings) {
    let engine: AiEngine | undefined

    if (b.session_id && sessionEngine.has(b.session_id)) {
      engine = sessionEngine.get(b.session_id)
    } else {
      const detected = classifyAiEngine({
        traffic_detail: b.traffic_detail,
        traffic_source: b.traffic_source,
      })
      if (detected) engine = detected
    }

    if (!engine) continue

    let agg = byEngine.get(engine.key)
    if (!agg) {
      const def = AI_ENGINES.find(e => e.key === engine.key)
      agg = {
        label: engine.label,
        sessions: 0,
        visitors: new Set(),
        bookings: 0,
        revenueCents: 0,
        availabilitySessions: 0,
        availabilityBookings: 0,
        availabilityRevenueCents: 0,
        testUrl: def?.testUrl ?? `https://${engine.key}.com`,
        searchUrl: def?.searchUrl() ?? `https://${engine.key}.com`,
      }
      byEngine.set(engine.key, agg)
    }

    agg.bookings++
    const amount = b.stripe_amount ?? 0
    agg.revenueCents += amount

    if (b.session_id && sessionAvailability.get(b.session_id)) {
      agg.availabilityBookings++
      agg.availabilityRevenueCents += amount
    }
  }

  return [...byEngine.entries()]
    .map(([key, a]) => ({
      key,
      label: a.label,
      sessions: a.sessions,
      visitors: a.visitors.size,
      bookings: a.bookings,
      revenueEuros: a.revenueCents / 100,
      availabilitySessions: a.availabilitySessions,
      availabilityBookings: a.availabilityBookings,
      availabilityRevenueEuros: a.availabilityRevenueCents / 100,
      testUrl: a.testUrl,
      searchUrl: a.searchUrl,
    }))
    .sort((x, y) => {
      // Sort by sessions descending; if equal, maintain core engine order
      if (y.sessions !== x.sessions) return y.sessions - x.sessions
      if (y.bookings !== x.bookings) return y.bookings - x.bookings
      const xCore = (CORE_AI_ENGINE_KEYS as readonly string[]).indexOf(x.key)
      const yCore = (CORE_AI_ENGINE_KEYS as readonly string[]).indexOf(y.key)
      if (xCore !== -1 && yCore !== -1) return xCore - yCore
      if (xCore !== -1) return -1
      if (yCore !== -1) return 1
      return x.label.localeCompare(y.label)
    })
}
