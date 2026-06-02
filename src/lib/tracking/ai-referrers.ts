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

interface AiEngineDef extends AiEngine {
  /** Referrer hostnames (without leading www.) that map to this engine. */
  hosts: string[]
}

export const AI_ENGINES: AiEngineDef[] = [
  { key: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { key: 'perplexity', label: 'Perplexity', hosts: ['perplexity.ai'] },
  { key: 'gemini', label: 'Gemini', hosts: ['gemini.google.com', 'bard.google.com'] },
  { key: 'copilot', label: 'Copilot', hosts: ['copilot.microsoft.com'] },
  { key: 'claude', label: 'Claude', hosts: ['claude.ai'] },
  { key: 'meta_ai', label: 'Meta AI', hosts: ['meta.ai'] },
  { key: 'deepseek', label: 'DeepSeek', hosts: ['deepseek.com', 'chat.deepseek.com'] },
  { key: 'grok', label: 'Grok', hosts: ['grok.com', 'x.ai'] },
  { key: 'mistral', label: 'Le Chat (Mistral)', hosts: ['chat.mistral.ai'] },
  { key: 'you', label: 'You.com', hosts: ['you.com'] },
  { key: 'poe', label: 'Poe', hosts: ['poe.com'] },
]

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

/** Returns the AI engine a referrer belongs to, or null if it isn't an AI engine. */
export function classifyAiReferrer(referrer: string | null | undefined): AiEngine | null {
  if (!referrer) return null
  const host = hostOf(referrer)
  if (!host) return null
  for (const engine of AI_ENGINES) {
    if (engine.hosts.some(h => host === h || host.endsWith(`.${h}`))) {
      return { key: engine.key, label: engine.label }
    }
  }
  return null
}

// ── Aggregation (pure) — sessions + bookings per engine ──────────────────────────
// Mirrors the app's existing attribution: a booking belongs to the session it was
// made in (bookings.session_id → analytics_sessions.id), revenue = stripe_amount
// (cents), anonymous visitor ids (anon_*) don't count toward unique visitors.

export interface AiReferralRow {
  key: string
  label: string
  sessions: number
  visitors: number
  bookings: number
  revenueEuros: number
}

export function aggregateAiReferrals(
  sessions: { id: string; visitor_id: string | null; referrer: string | null }[],
  bookings: { session_id: string | null; stripe_amount: number | null }[],
): AiReferralRow[] {
  const sessionEngine = new Map<string, AiEngine>()
  const byEngine = new Map<
    string,
    { label: string; sessions: number; visitors: Set<string>; bookings: number; revenueCents: number }
  >()

  for (const s of sessions) {
    const engine = classifyAiReferrer(s.referrer)
    if (!engine) continue
    sessionEngine.set(s.id, engine)
    let agg = byEngine.get(engine.key)
    if (!agg) {
      agg = { label: engine.label, sessions: 0, visitors: new Set(), bookings: 0, revenueCents: 0 }
      byEngine.set(engine.key, agg)
    }
    agg.sessions++
    if (s.visitor_id && !s.visitor_id.startsWith('anon_')) agg.visitors.add(s.visitor_id)
  }

  for (const b of bookings) {
    const engine = b.session_id ? sessionEngine.get(b.session_id) : undefined
    if (!engine) continue
    const agg = byEngine.get(engine.key)
    if (!agg) continue
    agg.bookings++
    agg.revenueCents += b.stripe_amount ?? 0
  }

  return [...byEngine.entries()]
    .map(([key, a]) => ({
      key,
      label: a.label,
      sessions: a.sessions,
      visitors: a.visitors.size,
      bookings: a.bookings,
      revenueEuros: a.revenueCents / 100,
    }))
    .sort((x, y) => y.sessions - x.sessions)
}
