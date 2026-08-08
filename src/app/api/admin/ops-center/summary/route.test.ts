import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

import { GET } from './route'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

type Proposal = {
  id: string
  kind: string
  status: string
  reasoning: string | null
  payload: unknown
  created_at: string
}
type OpsEvent = {
  id: string
  event_type: string
  payload: unknown
  occurred_at: string
}

/** A chainable query-builder stub that resolves whenever it's awaited, no
 * matter how many filter methods were called first — mirrors the real
 * supabase-js builder without hardcoding an exact chain length/order. */
function makeThenable<T>(result: T) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    in: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (resolve: (value: T) => void) => resolve(result),
  }
  return builder
}

function makeSupabase({
  proposals = [],
  events = [],
  emailsCount = 0,
}: {
  proposals?: Proposal[]
  events?: OpsEvent[]
  emailsCount?: number
}) {
  const from = vi.fn((table: string) => {
    if (table === 'agent_proposals') return makeThenable({ data: proposals, error: null })
    if (table === 'ops_events') return makeThenable({ data: events, error: null })
    if (table === 'messages') return makeThenable({ count: emailsCount, error: null })
    throw new Error(`unexpected table: ${table}`)
  })
  return { from }
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString()
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
})

describe('GET /api/admin/ops-center/summary', () => {
  it('rejects unauthenticated requests via requireAdmin', async () => {
    const denied = new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 })
    h.requireAdmin.mockResolvedValue(denied)
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({}) as never)

    const res = await GET()

    expect(res.status).toBe(401)
  })

  it('maps an executed schedule_day proposal to a taken item naming the assigned captain', async () => {
    const sb = makeSupabase({
      proposals: [
        {
          id: 'p1',
          kind: 'schedule_day',
          status: 'executed',
          reasoning: null,
          payload: { target_date: '2026-08-08', assignments: [{ staff_name: 'Sanne' }] },
          created_at: hoursAgo(1),
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET()
    const body = await res.json()

    expect(body.data.feed).toHaveLength(1)
    expect(body.data.feed[0]).toMatchObject({ id: 'p1', bucket: 'taken' })
    expect(body.data.feed[0].summary).toContain('Sanne')
  })

  it('maps a skipped proposal to a skipped item using its reasoning', async () => {
    const sb = makeSupabase({
      proposals: [
        {
          id: 'p2',
          kind: 'catering_upsell',
          status: 'skipped',
          reasoning: 'No guests met the upsell threshold today.',
          payload: {},
          created_at: hoursAgo(1),
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET()
    const body = await res.json()

    expect(body.data.feed).toHaveLength(1)
    expect(body.data.feed[0]).toMatchObject({
      id: 'p2',
      bucket: 'skipped',
      summary: 'No guests met the upsell threshold today.',
    })
  })

  it('maps a shadow proposal to a needs_approval item', async () => {
    const sb = makeSupabase({
      proposals: [
        {
          id: 'p3',
          kind: 'stock_reorder',
          status: 'shadow',
          reasoning: 'Running low on cups.',
          payload: {},
          created_at: hoursAgo(1),
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET()
    const body = await res.json()

    expect(body.data.feed).toHaveLength(1)
    expect(body.data.feed[0]).toMatchObject({ id: 'p3', bucket: 'needs_approval' })
  })

  it('maps an ads_campaign_paused ops_event to an automated item naming the campaign', async () => {
    const sb = makeSupabase({
      events: [
        {
          id: 'e1',
          event_type: 'ads_campaign_paused',
          payload: { campaignName: 'Search - Canal Cruises' },
          occurred_at: hoursAgo(1),
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET()
    const body = await res.json()

    expect(body.data.feed).toHaveLength(1)
    expect(body.data.feed[0]).toMatchObject({ id: 'e1', bucket: 'automated' })
    expect(body.data.feed[0].summary).toContain('Search - Canal Cruises')
  })

  it('regression: renders the real campaignName from guardrail.ts payload shape, not "undefined"', async () => {
    // Mirrors the exact payload shape emitted by runGuardrail() in
    // src/lib/google-ads/guardrail.ts (camelCase — the codebase's convention
    // for emitOpsEvent payloads, see gmail/sync.ts and cron/extras-upsell).
    // A prior bug had this route read `payload.campaign_name` (snake_case),
    // which never matched and silently rendered `"undefined"` in the feed.
    const sb = makeSupabase({
      events: [
        {
          id: 'e-guardrail',
          event_type: 'ads_campaign_paused',
          payload: {
            campaignId: '12345',
            campaignName: 'Search - Canal Cruises NL',
            reason: 'High spend, zero conversions over 30 days',
            costEuros: 142.5,
            conversions: 0,
          },
          occurred_at: hoursAgo(1),
        },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET()
    const body = await res.json()

    expect(body.data.feed).toHaveLength(1)
    expect(body.data.feed[0].summary).toContain('Search - Canal Cruises NL')
    expect(body.data.feed[0].summary).not.toContain('undefined')
  })

  it('maps extras_upsell_sent and catering_order_sent ops_events to automated items', async () => {
    const sb = makeSupabase({
      events: [
        { id: 'e2', event_type: 'extras_upsell_sent', payload: {}, occurred_at: hoursAgo(1) },
        { id: 'e3', event_type: 'catering_order_sent', payload: {}, occurred_at: hoursAgo(2) },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET()
    const body = await res.json()

    expect(body.data.feed).toHaveLength(2)
    expect(body.data.feed.every((f: { bucket: string }) => f.bucket === 'automated')).toBe(true)
  })

  it('counts emailsProcessedToday from the messages table query result', async () => {
    const sb = makeSupabase({ emailsCount: 7 })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET()
    const body = await res.json()

    expect(body.data.emailsProcessedToday).toBe(7)
    expect(sb.from).toHaveBeenCalledWith('messages')
  })

  it('badgeCount sums needs_approval + skipped from the last 24h only, excluding taken and automated', async () => {
    const sb = makeSupabase({
      proposals: [
        { id: 'p-shadow-recent', kind: 'ops_review', status: 'shadow', reasoning: 'r', payload: {}, created_at: hoursAgo(1) },
        { id: 'p-skipped-recent', kind: 'ops_review', status: 'skipped', reasoning: 'r', payload: {}, created_at: hoursAgo(2) },
        { id: 'p-executed-recent', kind: 'schedule_day', status: 'executed', reasoning: null, payload: { assignments: [] }, created_at: hoursAgo(1) },
        // Older than 24h: still shows in the feed, but must not count toward the badge.
        { id: 'p-shadow-old', kind: 'ops_review', status: 'shadow', reasoning: 'r', payload: {}, created_at: hoursAgo(30) },
      ],
      events: [
        { id: 'e-automated-recent', event_type: 'ads_campaign_paused', payload: { campaignName: 'X' }, occurred_at: hoursAgo(1) },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb as never)

    const res = await GET()
    const body = await res.json()

    expect(body.data.feed).toHaveLength(5)
    expect(body.data.badgeCount).toBe(2)
  })
})
