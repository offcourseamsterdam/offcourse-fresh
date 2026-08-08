import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { amsterdamToday } from '@/lib/utils'

const OPS_KINDS = ['schedule_day', 'catering_order', 'catering_upsell', 'maintenance_task', 'stock_reorder', 'ops_review', 'guest_move_request']
const AUTOMATED_EVENT_TYPES = ['catering_order_sent', 'extras_upsell_sent', 'ads_campaign_paused']

interface FeedItem {
  id: string
  kind: string
  bucket: 'needs_approval' | 'taken' | 'skipped' | 'automated'
  summary: string
  occurredAt: string
  href: string
}

function summarizeProposal(kind: string, status: string, reasoning: string | null, payload: Record<string, unknown>): string {
  if (status === 'skipped') return reasoning ?? `${kind.replace(/_/g, ' ')} — nothing confidently actionable.`
  if (kind === 'schedule_day') {
    const assignments = (payload.assignments as { staff_name?: string }[] | undefined) ?? []
    return assignments.length
      ? `Assigned ${assignments.map(a => a.staff_name).filter(Boolean).join(', ')} for ${payload.target_date}`
      : `Schedule review for ${payload.target_date}`
  }
  return reasoning ?? kind.replace(/_/g, ' ')
}

function summarizeAutomatedEvent(eventType: string, payload: Record<string, unknown>): string {
  if (eventType === 'ads_campaign_paused') return `Paused ad campaign "${payload.campaignName}" — spend with no bookings`
  if (eventType === 'extras_upsell_sent') return 'Sent an extras upsell email'
  if (eventType === 'catering_order_sent') return 'Sent a catering order to the supplier'
  return eventType.replace(/_/g, ' ')
}

/**
 * GET /api/admin/ops-center/summary
 *
 * The Ops Center badge count + recent-activity feed: four buckets across two
 * source tables. `agent_proposals` carries AI judgment either way it landed —
 * `needs_approval` (still shadow, awaiting a human) and `skipped` (the AI
 * looked and decided there was nothing worth proposing) and `taken` (a
 * proposal that actually executed). `ops_events` is the opposite: plain code
 * that ran on its own, zero AI judgment, surfaced as `automated`.
 *
 * Deliberately shallow — one line + a link per item. The rich per-kind detail
 * views live at /admin/ghost; this endpoint only powers the badge + glance feed.
 *
 * The feed window is 48h (so the panel shows two days of context), but the
 * badge count — "does this need a glance right now" — only looks at the last
 * 24h. Already-completed actions (taken, automated) never count toward the
 * badge regardless of age.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const since48 = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const since24 = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const today = amsterdamToday()

    const [proposalsRes, eventsRes, emailsRes] = await Promise.all([
      supabase
        .from('agent_proposals')
        .select('id, kind, status, reasoning, payload, created_at')
        .in('kind', OPS_KINDS)
        .in('status', ['shadow', 'executed', 'skipped'])
        .gte('created_at', since48)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('ops_events')
        .select('id, event_type, payload, occurred_at')
        .in('event_type', AUTOMATED_EVENT_TYPES)
        .gte('occurred_at', since48)
        .order('occurred_at', { ascending: false })
        .limit(30),
      supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('provider', 'gmail')
        .eq('direction', 'in')
        .gte('created_at', `${today}T00:00:00Z`),
    ])

    if (proposalsRes.error) return apiError(proposalsRes.error.message)
    if (eventsRes.error) return apiError(eventsRes.error.message)
    if (emailsRes.error) return apiError(emailsRes.error.message)

    const proposalItems: FeedItem[] = (proposalsRes.data ?? []).map(p => ({
      id: p.id,
      kind: p.kind,
      bucket: p.status === 'shadow' ? 'needs_approval' : p.status === 'skipped' ? 'skipped' : 'taken',
      summary: summarizeProposal(p.kind, p.status, p.reasoning, (p.payload as Record<string, unknown>) ?? {}),
      occurredAt: p.created_at,
      href: '/admin/ghost',
    }))

    const automatedItems: FeedItem[] = (eventsRes.data ?? []).map(e => ({
      id: e.id,
      kind: e.event_type,
      bucket: 'automated',
      summary: summarizeAutomatedEvent(e.event_type, (e.payload as Record<string, unknown>) ?? {}),
      occurredAt: e.occurred_at,
      href: e.event_type === 'ads_campaign_paused' ? '/admin/google-ads' : '/admin/catering',
    }))

    const feed = [...proposalItems, ...automatedItems].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

    const badgeCount = feed.filter(
      f => (f.bucket === 'needs_approval' || f.bucket === 'skipped') && f.occurredAt >= since24
    ).length

    return apiOk({
      badgeCount,
      emailsProcessedToday: emailsRes.count ?? 0,
      feed,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
