'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  BookOpen,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  Circle,
  Euro,
  Ghost,
  HelpCircle,
  Inbox,
  Loader2,
  Package,
  RefreshCw,
  Send,
  Ship,
  Sparkles,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { adminMutate } from '@/hooks/useAdminSave'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { GHOST_AGENTS, agentForKind, agentAutonomy } from '@/lib/ghost/agents'
import { replySimilarity, type SimilarityLabel } from '@/lib/ghost/similarity'
import { formatAmsterdamTime } from '@/lib/utils'

/**
 * The Ghost AI's notebook — shadow-mode proposals, read-only + teachable.
 *
 * The learning loop, visible:
 *  - every reply draft shows the human's ACTUAL reply once sent (the correction)
 *  - the questions panel lists what the Ghost is unsure about; answering
 *    feeds ghost_knowledge, which is injected into every future draft
 *  - the stats strip counts corrections + taught facts — learning, measured
 */

interface ScheduleAssignment {
  shift_id: string
  staff_id: string
  staff_name: string
  reason: string
}

interface CateringOrder {
  date: string
  items: { name: string; quantity: number }[]
  urgent_unsent: number
}

interface OpsRecommendation {
  type: 'consolidate_gap' | 'consolidate_boat' | 'staffing_level' | 'maintenance_conflict' | 'none'
  summary: string
  why: string
  est_saving_cents: number
  guest_impact: 'none' | 'low' | 'high'
  requires_guest_contact: boolean
  confidence: number
}

interface AgentStepLog {
  tool: string
  input: Record<string, unknown>
  result_preview: string
}

interface BookingAction {
  listing_slug?: string
  listing_title?: string
  date?: string
  time?: string
  guests?: number
  option?: string
  price_eur?: number
}

interface DryRunVerdict {
  ran_at: string
  is_bookable: boolean
  code: string | null
  error: string | null
  receipt_total_eur: number | null
  checked_avail_pk: number | null
}

interface GhostProposal {
  id: string
  kind: string
  payload: {
    reply?: string
    language?: string
    open_question?: string | null
    target_date?: string
    assignments?: ScheduleAssignment[]
    orders?: CateringOrder[]
    booking?: BookingAction
    steps?: AgentStepLog[]
    verdict?: DryRunVerdict
    // maintenance_task
    priority?: 'essential' | 'cosmetic' | 'wishlist'
    title?: string
    summary?: string
    photo_descriptions?: string[]
    email_subject?: string
    email_body?: string
    recipient?: string | null
    maintenance_task_id?: string
    // stock_reorder
    urgency?: 'urgent' | 'routine'
    supplier_name?: string | null
    items?: { name: string; quantity: number; unit?: string; pack_size?: number | null; pack_unit?: string | null }[]
    item_ids?: string[]
    // guest_move_request
    guest_name?: string | null
    guest_email?: string | null
    guest_phone?: string | null
    cruise_title?: string | null
    boat?: string
    current_start_at?: string
    proposed_start_at?: string
    gap_minutes?: number
    est_saving_cents?: number
    total_cents?: number | null
    incentive?: string
    sms_text?: string
    // catering_upsell (shares guest_name/cruise_title/recipient/email_* fields)
    guest_count?: number | null
    // ops_review
    recommendations?: OpsRecommendation[]
    facts?: {
      boats_in_use?: string[]
      total_idle_minutes?: number
      total_est_idle_cost_cents?: number
      open_shifts?: number
      merge_candidates?: number
      maintenance_conflicts?: number
    }
  }
  reasoning: string | null
  status: string
  model: string | null
  outcome: {
    human_reply?: string
    replied_by?: string
    replied_at?: string
    comparison?: { verdict: SimilarityLabel; summary: string }
    sent_at?: string
    recipient?: string
    channels?: string[]
    guest_response?: string
    responded_at?: string
    // schedule_day apply + evaluation
    applied_at?: string
    applied?: { shift_id: string; staff_name?: string }[]
    agreement?: {
      matched: number
      total: number
      details: { shift_id: string; proposed_name?: string | null; actual_name?: string | null; matched: boolean }[]
    }
  } | null
  reviewed_at: string | null
  created_at: string
  conversation: {
    id: string
    channel: string
    contact: { name: string; email: string | null; locale: string | null } | null
  } | null
  trigger: { body: string; author_name: string | null; created_at: string } | null
}

interface GhostData {
  proposals: GhostProposal[]
  hasMore: boolean
  spend: {
    totalEur: number
    last30dEur: number
    calls: number
    byFeature: { feature: string; totalEur: number; calls: number }[]
  }
  stats: {
    total: number
    reviewed: number
    byKind: Record<string, number>
    corrected: number
    awaitingComparison: number
    openQuestions: number
    knowledgeEntries: number
  }
  openQuestions: { proposal_id: string; question: string; contact: string | null; created_at: string }[]
  knowledge: { id: string; question: string; answer: string; pinned: boolean; created_at: string }[]
}

const POLL_MS = 15_000

const PAGE_SIZE = 25

const CONVO_AGENTS = ['inbox', 'booking']

// Friendly names for the ai_usage feature tags, so the spend breakdown reads in
// plain English. Unknown tags fall back to a humanised version of the raw tag.
const FEATURE_LABEL: Record<string, string> = {
  ghost_agent_inbox: 'Inbox replies',
  ghost_reply_draft: 'Inbox replies',
  ghost_compare: 'Reply comparison',
  chat_translate: 'Message translation',
  ghost_catering_order: 'Catering drafts',
  ghost_schedule_day: 'Scheduling drafts',
  ghost_maintenance_task: 'Maintenance drafts',
  ghost_maintenance_photo: 'Maintenance photos',
  ghost_stock_reorder: 'Stock reorders',
  ghost_ops_review: 'Operations reviews',
  ghost_guest_move: 'Guest move requests',
  ghost_catering_upsell: 'Snackbox upsells',
}

function featureLabel(feature: string): string {
  return FEATURE_LABEL[feature] ?? feature.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

export default function GhostPage() {
  const router = useRouter()
  const params = useParams()
  const locale = (params?.locale as string) ?? 'en'
  const [agentFilter, setAgentFilter] = useState<string | null>(null)
  const [unreviewedOnly, setUnreviewedOnly] = useState(false)
  const [limit, setLimit] = useState(PAGE_SIZE)

  const { data, isLoading, error, refresh } = useAdminFetch<GhostData>(
    `/api/admin/ghost?limit=${limit}&reviewed=${unreviewedOnly ? 'unreviewed' : 'all'}`,
    { refreshInterval: POLL_MS },
  )

  // Conversation drafts (reply_draft, booking_proposal) live in the inbox now —
  // this page is the cross-conversation ops dashboard: ops proposals + stats.
  const OPS_KINDS = ['schedule_day', 'catering_order', 'catering_upsell', 'maintenance_task', 'stock_reorder', 'ops_review', 'guest_move_request']
  const allProposals = (data?.proposals ?? []).filter(p => OPS_KINDS.includes(p.kind))
  const proposals = agentFilter
    ? allProposals.filter(p => agentForKind(p.kind)?.key === agentFilter)
    : allProposals

  // Actionable = still shadow AND carries a one-click action (send / assign).
  const ACTIONABLE_KINDS = ['schedule_day', 'catering_upsell', 'maintenance_task', 'stock_reorder', 'guest_move_request']
  const needsDecision = allProposals.filter(
    p =>
      p.status === 'shadow' &&
      ACTIONABLE_KINDS.includes(p.kind) &&
      (p.kind === 'schedule_day' ? (p.payload.assignments?.length ?? 0) > 0 : !!p.payload.email_body || !!p.payload.sms_text),
  )

  // Ghost ↔ you agreement over the loaded schedule evaluations (the learning score).
  const agreementTotals = allProposals.reduce(
    (acc, p) => {
      const a = p.outcome?.agreement
      if (p.kind === 'schedule_day' && a?.total) {
        acc.matched += a.matched
        acc.total += a.total
      }
      return acc
    },
    { matched: 0, total: 0 },
  )

  function agentCount(agentKey: string): number {
    const agent = GHOST_AGENTS.find(a => a.key === agentKey)
    if (!agent || !data) return 0
    return agent.kinds.reduce((sum, kind) => sum + (data.stats.byKind[kind] ?? 0), 0)
  }

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 inline-flex items-center gap-2">
            <Ghost className="w-6 h-6 text-violet-500" /> AI Operations
          </h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            Every Ghost proposal, what needs your decision, and what it learned afterwards.
            Conversation drafts live in the <strong>inbox</strong>, next to each customer.
          </p>
          <a
            href={`/${locale}/admin/ghost/rulebook`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 hover:text-violet-800 mt-2"
          >
            <BookOpen className="w-3.5 h-3.5" /> The Rulebook — what the AI reads before it acts
          </a>
        </div>

        {data && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 inline-flex items-center gap-1">
              <Euro className="w-3 h-3" /> AI spend
            </p>
            <p className="text-lg font-semibold text-zinc-900 leading-tight">
              €{data.spend.totalEur.toFixed(2)}
            </p>
            <p className="text-[11px] text-zinc-400">
              €{data.spend.last30dEur.toFixed(2)} last 30d · {data.spend.calls} calls · alert every €5
            </p>
          </div>
        )}
      </div>

      <AdminErrorBanner error={error} />

      {/* Stats strip — is it learning? */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5">
          <StatCard label="Proposals" value={data.stats.total} sub={`${data.stats.reviewed} reviewed · ${data.stats.total - data.stats.reviewed} to review`} />
          <StatCard label="Corrected by you" value={data.stats.corrected} sub={`${data.stats.awaitingComparison} awaiting your reply`} accent="violet" />
          <StatCard label="Open questions" value={data.stats.openQuestions} sub="answer them below" accent={data.stats.openQuestions > 0 ? 'amber' : undefined} />
          <StatCard label="Things taught" value={data.stats.knowledgeEntries} sub="in every future draft" accent="emerald" />
        </div>
      )}

      {/* Spend by agent — which AI surface actually costs money (all-time) */}
      {data && data.spend.byFeature.length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 mb-5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-3 inline-flex items-center gap-1">
            <Euro className="w-3 h-3" /> Spend by agent (all-time)
          </p>
          <div className="space-y-2">
            {data.spend.byFeature.map(f => {
              const max = data.spend.byFeature[0].totalEur || 1
              const pct = Math.max(2, Math.round((f.totalEur / max) * 100))
              return (
                <div key={f.feature} className="flex items-center gap-3 text-xs">
                  <span className="w-36 shrink-0 truncate text-zinc-600" title={f.feature}>
                    {featureLabel(f.feature)}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-zinc-100 overflow-hidden">
                    <div className="h-full rounded-full bg-violet-400" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-16 shrink-0 text-right font-medium text-zinc-900 tabular-nums">
                    €{f.totalEur.toFixed(2)}
                  </span>
                  <span className="w-16 shrink-0 text-right text-zinc-400 tabular-nums">
                    {f.calls} {f.calls === 1 ? 'call' : 'calls'}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* The agent fleet — one agent per operation domain, click to filter */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-5">
          {GHOST_AGENTS.map(agent => {
            const Icon = AGENT_ICONS[agent.key] ?? Ghost
            const planned = agent.status === 'planned'
            const active = agentFilter === agent.key
            return (
              <button
                key={agent.key}
                onClick={() => {
                  if (planned) return
                  // Conversation agents do their work in the inbox — go there.
                  if (CONVO_AGENTS.includes(agent.key)) { router.push(`/${locale}/admin/inbox`); return }
                  setAgentFilter(f => (f === agent.key ? null : agent.key))
                }}
                disabled={planned}
                title={CONVO_AGENTS.includes(agent.key) ? `${agent.description} — open in the inbox` : agent.description}
                className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  planned
                    ? 'border-dashed border-zinc-200 bg-zinc-50 cursor-default'
                    : active
                      ? 'border-violet-400 bg-violet-50'
                      : 'border-zinc-200 bg-white hover:border-violet-200'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <Icon className={`w-4 h-4 ${planned ? 'text-zinc-300' : 'text-violet-500'}`} />
                  {planned ? (
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400">soon</span>
                  ) : (
                    <span className="text-sm font-semibold text-zinc-900">{agentCount(agent.key)}</span>
                  )}
                </div>
                <p className={`text-xs font-medium leading-tight ${planned ? 'text-zinc-400' : 'text-zinc-700'}`}>
                  {agent.name}
                </p>
                {!planned && (
                  <span className="inline-block mt-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-500">
                    {AUTONOMY_LABEL[agentAutonomy(agent)]}
                  </span>
                )}
                <p className="text-[10px] text-zinc-400 truncate">{agent.trigger}</p>
              </button>
            )
          })}
        </div>
      )}

      {/* Questions panel — the Ghost's homework for the team */}
      {data && data.openQuestions.length > 0 && (
        <QuestionsPanel questions={data.openQuestions} onAnswered={refresh} />
      )}

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading the Ghost&apos;s notebook…
        </div>
      )}

      {/* Needs your decision — actionable proposals waiting for a click */}
      {data && needsDecision.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-4">
          <p className="text-sm font-semibold text-amber-800">
            ⚡ {needsDecision.length} proposal{needsDecision.length === 1 ? '' : 's'} need{needsDecision.length === 1 ? 's' : ''} your decision
          </p>
          <p className="text-xs text-amber-700 mt-0.5">
            {needsDecision
              .map(p => `${KIND_META[p.kind]?.label ?? p.kind}${p.payload.target_date ? ` (${p.payload.target_date})` : ''}`)
              .join(' · ')}
            {' — cards below; unapproved proposals are scored against reality after their date passes.'}
          </p>
        </div>
      )}

      {/* Ghost ↔ you agreement — the learning score from expired drafts */}
      {data && agreementTotals.total > 0 && (
        <p className="text-xs text-zinc-500 mb-4">
          🎯 Recent schedule agreement: the Ghost matched your actual captain choice in{' '}
          <span className="font-semibold text-zinc-700">
            {agreementTotals.matched}/{agreementTotals.total}
          </span>{' '}
          shifts ({Math.round((agreementTotals.matched / agreementTotals.total) * 100)}%) — mismatches are fed back into future drafts.
        </p>
      )}

      {/* Proposal list header — filters */}
      {data && (
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-semibold text-zinc-700">
            Ops proposals
            {agentFilter && (
              <button onClick={() => setAgentFilter(null)} className="ml-2 text-xs font-normal text-violet-600 hover:underline">
                clear filter ✕
              </button>
            )}
          </p>
          <button
            onClick={() => { setUnreviewedOnly(v => !v); setLimit(PAGE_SIZE) }}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
              unreviewedOnly ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            <Circle className="w-3 h-3" /> Unreviewed only
          </button>
        </div>
      )}

      {data && proposals.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center">
          <Ghost className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            {unreviewedOnly
              ? 'All caught up — nothing left to review.'
              : agentFilter
                ? 'No proposals from this agent yet.'
                : 'No ops proposals yet — the daily ops cron (catering + schedule) drafts these. Conversation drafts live in the inbox.'}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {proposals.map(p => (
          <ProposalCard key={p.id} proposal={p} onChanged={refresh} />
        ))}
      </div>

      {/* Pagination — grow the page; newest stay live-polled */}
      {data?.hasMore && !agentFilter && (
        <button
          onClick={() => setLimit(l => l + PAGE_SIZE)}
          className="mt-4 w-full rounded-lg border border-zinc-200 bg-white py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
        >
          Load older proposals
        </button>
      )}

      {/* The visible memory — every fact the team has taught the Ghost */}
      {data && data.knowledge.length > 0 && (
        <KnowledgePanel knowledge={data.knowledge} onChanged={refresh} />
      )}
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: 'violet' | 'amber' | 'emerald' }) {
  const accentClass =
    accent === 'violet' ? 'text-violet-600' : accent === 'amber' ? 'text-amber-600' : accent === 'emerald' ? 'text-emerald-600' : 'text-zinc-900'
  return (
    <div className="rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      <p className={`text-xl font-semibold leading-tight ${accentClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-400 truncate" title={sub}>{sub}</p>}
    </div>
  )
}

/** The Ghost asks, you answer, it knows forever. */
function QuestionsPanel({
  questions,
  onAnswered,
}: {
  questions: { proposal_id: string; question: string; contact: string | null; created_at: string }[]
  onAnswered: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [errorId, setErrorId] = useState<string | null>(null)

  async function answer(proposalId: string, question: string) {
    const text = drafts[proposalId]?.trim()
    if (!text) return
    setBusy(prev => ({ ...prev, [proposalId]: true }))
    setErrorId(null)
    try {
      await adminMutate('/api/admin/ghost/knowledge', 'POST', {
        question,
        answer: text,
        proposal_id: proposalId,
      })
      setDrafts(prev => ({ ...prev, [proposalId]: '' }))
      onAnswered()
    } catch {
      setErrorId(proposalId)
    } finally {
      setBusy(prev => ({ ...prev, [proposalId]: false }))
    }
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 mb-5">
      <p className="text-sm font-semibold text-amber-900 inline-flex items-center gap-1.5 mb-1">
        <HelpCircle className="w-4 h-4" /> The Ghost wants to know
      </p>
      <p className="text-xs text-amber-700 mb-3">
        Things it was unsure about while drafting. Your answer is taught permanently — every future
        draft knows it.
      </p>
      <div className="space-y-3">
        {questions.map(q => (
          <div key={q.proposal_id} className="bg-white rounded-lg border border-amber-200 p-3">
            <p className="text-sm text-zinc-800 mb-2">
              <span className="font-medium">{q.question}</span>
              {q.contact && <span className="ml-2 text-[11px] text-amber-600">· from {q.contact}</span>}
              <span className="ml-2 text-[11px] text-zinc-400">{formatAmsterdamTime(q.created_at)}</span>
            </p>
            <div className="flex items-end gap-2">
              <textarea
                value={drafts[q.proposal_id] ?? ''}
                onChange={e => setDrafts(prev => ({ ...prev, [q.proposal_id]: e.target.value }))}
                placeholder="Answer it once — the Ghost remembers…"
                rows={2}
                maxLength={2000}
                className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-amber-300/50"
              />
              <button
                onClick={() => answer(q.proposal_id, q.question)}
                disabled={busy[q.proposal_id] || !drafts[q.proposal_id]?.trim()}
                className="rounded-lg bg-amber-600 text-white px-3 py-2 text-xs font-semibold hover:bg-amber-700 disabled:opacity-40 inline-flex items-center gap-1.5 shrink-0"
              >
                {busy[q.proposal_id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />}
                Teach
              </button>
            </div>
            {errorId === q.proposal_id && <p className="text-xs text-red-600 mt-1">Could not save — try again?</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

const AGENT_ICONS: Record<string, typeof Ghost> = {
  inbox: Inbox,
  booking: CalendarPlus,
  catering: UtensilsCrossed,
  scheduling: CalendarClock,
  maintenance: Wrench,
  storage: Package,
  operations: Ship,
}

const KIND_META: Record<string, { label: string; Icon: typeof Ghost }> = {
  reply_draft: { label: 'Reply draft', Icon: Inbox },
  booking_proposal: { label: 'Booking', Icon: CalendarPlus },
  schedule_day: { label: 'Schedule', Icon: CalendarClock },
  catering_order: { label: 'Catering', Icon: UtensilsCrossed },
  maintenance_task: { label: 'Maintenance', Icon: Wrench },
  stock_reorder: { label: 'Stock reorder', Icon: Package },
  ops_review: { label: 'Ops review', Icon: Ship },
  guest_move_request: { label: 'Guest move', Icon: Send },
  catering_upsell: { label: 'Snackbox upsell', Icon: UtensilsCrossed },
}

/** Chip colours + labels per ops-review recommendation type. */
const OPS_REC_BADGE: Record<string, string> = {
  maintenance_conflict: 'bg-red-100 text-red-700',
  staffing_level: 'bg-amber-100 text-amber-700',
  consolidate_boat: 'bg-violet-100 text-violet-700',
  consolidate_gap: 'bg-sky-100 text-sky-700',
  none: 'bg-emerald-100 text-emerald-700',
}
const OPS_REC_LABEL: Record<string, string> = {
  maintenance_conflict: 'Maintenance conflict',
  staffing_level: 'Staffing',
  consolidate_boat: 'Consolidate boat',
  consolidate_gap: 'Close gap',
  none: 'Already optimal',
}

/** Classification chip colours for maintenance proposals. */
const MAINT_BADGE: Record<string, string> = {
  essential: 'bg-red-100 text-red-700',
  cosmetic: 'bg-amber-100 text-amber-700',
  wishlist: 'bg-sky-100 text-sky-700',
}
const MAINT_LABEL: Record<string, string> = {
  essential: 'Essential',
  cosmetic: 'Cosmetic',
  wishlist: 'Wish-list',
}

const AUTONOMY_LABEL: Record<string, string> = {
  propose: 'shadow',
  dry_run: 'dry-run',
  ask: 'ask first',
  auto: 'auto',
}

/** The dry-run verdict chip — "would this have booked?" with a Re-check button. */
function DryRunVerdictChip({
  proposalId,
  verdict,
  onRechecked,
}: {
  proposalId: string
  verdict?: DryRunVerdict
  onRechecked: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function recheck() {
    setBusy(true)
    try {
      await adminMutate('/api/admin/ghost/dry-run', 'POST', { proposalId })
      onRechecked()
    } catch {
      /* leave the old verdict; user can retry */
    } finally {
      setBusy(false)
    }
  }

  const base = 'mt-1.5 rounded-lg px-3 py-2 text-xs flex items-start justify-between gap-2'
  if (!verdict) {
    return (
      <div className={`${base} bg-zinc-50 border border-zinc-200 text-zinc-500`}>
        <span>Dry-run pending…</span>
        <button onClick={recheck} disabled={busy} className="font-semibold text-zinc-600 hover:text-zinc-900 disabled:opacity-50 inline-flex items-center gap-1">
          {busy && <Loader2 className="w-3 h-3 animate-spin" />} Check now
        </button>
      </div>
    )
  }
  const ok = verdict.is_bookable
  return (
    <div className={`${base} ${ok ? 'bg-emerald-50 border border-emerald-200 text-emerald-900' : 'bg-amber-50 border border-amber-200 text-amber-900'}`}>
      <span className="min-w-0">
        <span className="font-semibold">
          {ok ? '✓ Would book successfully' : '✗ Would NOT book'}
        </span>
        {ok && verdict.receipt_total_eur != null && <span> — FareHarbor quote €{verdict.receipt_total_eur}</span>}
        {!ok && (verdict.error || verdict.code) && <span> — {verdict.error ?? verdict.code}</span>}
        <span className="block text-[10px] opacity-70 mt-0.5">
          validated, nothing created, no email · {formatAmsterdamTime(verdict.ran_at)}
        </span>
      </span>
      <button onClick={recheck} disabled={busy} className="font-semibold hover:underline disabled:opacity-50 inline-flex items-center gap-1 shrink-0">
        {busy && <Loader2 className="w-3 h-3 animate-spin" />} Re-check
      </button>
    </div>
  )
}

/** The knowledge base — every taught fact, pinnable so it never falls off recency. */
function KnowledgePanel({
  knowledge,
  onChanged,
}: {
  knowledge: GhostData['knowledge']
  onChanged: () => void
}) {
  async function togglePin(id: string, pinned: boolean) {
    try {
      await adminMutate('/api/admin/ghost/knowledge', 'PATCH', { id, pinned })
      onChanged()
    } catch {
      /* no-op; poll will reconcile */
    }
  }

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-zinc-900 inline-flex items-center gap-1.5 mb-1">
        <BookOpen className="w-4 h-4 text-violet-500" /> What the Ghost knows
      </h2>
      <p className="text-xs text-zinc-400 mb-3">
        Its memory lives here, not in the model. Pin a fact to inject it into every reply forever
        (regardless of age) — use it for things like boat capacity or the refund policy.
      </p>
      <div className="space-y-1.5">
        {knowledge.map(k => (
          <div key={k.id} className="bg-white rounded-lg border border-zinc-200 px-3 py-2 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-medium text-zinc-700">{k.question}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{k.answer}</p>
            </div>
            <button
              onClick={() => togglePin(k.id, !k.pinned)}
              title={k.pinned ? 'Pinned — always injected. Click to unpin.' : 'Pin so this is always injected.'}
              className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full shrink-0 ${
                k.pinned ? 'bg-violet-100 text-violet-700' : 'text-zinc-400 hover:bg-zinc-100'
              }`}
            >
              {k.pinned ? '★ pinned' : '☆ pin'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

const COMPARE_BADGE: Record<SimilarityLabel, { text: string; cls: string }> = {
  match: { text: '≈ matched your reply', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  minor: { text: 'minor edits', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  different: { text: 'you rewrote it', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
}

function ProposalCard({ proposal: p, onChanged }: { proposal: GhostProposal; onChanged: () => void }) {
  const meta = KIND_META[p.kind] ?? { label: p.kind, Icon: Ghost }
  const agent = agentForKind(p.kind)
  const conversational = p.kind === 'reply_draft' || p.kind === 'booking_proposal'
  const reviewed = !!p.reviewed_at
  const [busy, setBusy] = useState<'review' | 'redraft' | 'compare' | 'send' | 'send_move' | 'apply_schedule' | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)

  async function act(action: 'review' | 'redraft' | 'compare' | 'send' | 'send_move' | 'apply_schedule', extra: Record<string, unknown> = {}) {
    setBusy(action)
    try {
      await adminMutate(`/api/admin/ghost/proposals/${p.id}`, 'POST', { action, ...extra })
      onChanged()
    } catch {
      /* surfaced by the page error banner on next poll */
    } finally {
      setBusy(null)
    }
  }

  // The cheap, always-on "did it match?" badge (the deep AI explanation is on demand).
  const sim =
    conversational && p.payload.reply && p.outcome?.human_reply
      ? replySimilarity(p.payload.reply, p.outcome.human_reply)
      : null

  return (
    <div className={`bg-white rounded-xl border overflow-hidden ${reviewed ? 'border-zinc-200' : 'border-violet-200'}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60">
        <div className="flex items-center gap-2 min-w-0">
          <meta.Icon className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="text-xs font-semibold text-violet-600 uppercase tracking-wide">
            {agent?.name ?? meta.label}
          </span>
          {conversational ? (
            <>
              <span className="text-sm font-medium text-zinc-800 truncate">
                {p.conversation?.contact?.name ?? 'Unknown'}
              </span>
              {p.payload.language && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium">
                  {p.payload.language}
                </span>
              )}
            </>
          ) : (
            p.payload.target_date && (
              <span className="text-sm font-medium text-zinc-800">{p.payload.target_date}</span>
            )
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-500 font-medium uppercase tracking-wide">
            {p.status}
          </span>
          <span className="text-xs text-zinc-400">{formatAmsterdamTime(p.created_at)}</span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Inbox/booking — customer message + investigation + draft + correction */}
        {conversational && (
          <>
            {p.trigger && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
                  Customer wrote
                </p>
                <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-sm text-zinc-700 whitespace-pre-wrap">
                  {p.trigger.body}
                </div>
              </div>
            )}

            {/* The chain of actions — what the agent looked up before deciding */}
            {(p.payload.steps?.length ?? 0) > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
                  Agent investigated
                </p>
                <ol className="space-y-1">
                  {p.payload.steps!.map((s, i) => (
                    <li key={i} className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5 font-mono">
                      <span className="text-violet-600 font-semibold">{i + 1}. {s.tool}</span>
                      <span className="text-zinc-400">({JSON.stringify(s.input)})</span>
                      <span className="block text-zinc-500 truncate" title={s.result_preview}>→ {s.result_preview}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                Ghost would reply
              </p>
              <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm text-violet-900 whitespace-pre-wrap">
                {p.payload.reply ?? '—'}
              </div>
            </div>

            {/* The proposed booking action — what a human would approve */}
            {p.payload.booking && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600 mb-1">
                  Proposed action — create booking
                </p>
                <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2 text-sm text-indigo-900">
                  <span className="font-semibold">{p.payload.booking.listing_title}</span>
                  <span className="block mt-0.5">
                    {p.payload.booking.date} · {p.payload.booking.time} · {p.payload.booking.guests} guests
                    {p.payload.booking.option ? ` · ${p.payload.booking.option}` : ''}
                    {p.payload.booking.price_eur ? ` · €${p.payload.booking.price_eur}` : ''}
                  </span>
                </div>
                <DryRunVerdictChip proposalId={p.id} verdict={p.payload.verdict} onRechecked={onChanged} />
                <p className="text-[11px] text-zinc-400 mt-1">
                  Booking creation stays human-approved — the Ghost only validates (no booking, no email).
                </p>
              </div>
            )}

            {p.outcome?.human_reply && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 mb-1 flex items-center gap-2">
                  {p.outcome.replied_by ?? 'You'} actually replied
                  {sim && (
                    <span className={`text-[9px] normal-case px-1.5 py-0.5 rounded-full border font-medium ${COMPARE_BADGE[sim.label].cls}`}>
                      {COMPARE_BADGE[sim.label].text}
                    </span>
                  )}
                </p>
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm text-emerald-900 whitespace-pre-wrap">
                  {p.outcome.human_reply}
                </div>
                {/* The lesson — what changed, on demand */}
                {p.outcome.comparison ? (
                  <p className="text-[11px] text-zinc-500 mt-1.5 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5">
                    <Sparkles className="w-3 h-3 inline mr-1 -mt-0.5 text-violet-500" />
                    <span className="font-semibold text-zinc-600">Lesson:</span> {p.outcome.comparison.summary}
                  </p>
                ) : (
                  <button
                    onClick={() => act('compare')}
                    disabled={busy === 'compare'}
                    className="text-[11px] text-violet-600 hover:underline mt-1.5 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {busy === 'compare' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                    What did the Ghost learn from this?
                  </button>
                )}
              </div>
            )}
            {p.payload.open_question && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                <HelpCircle className="w-3 h-3 inline mr-1 -mt-0.5" />
                Ghost asked: {p.payload.open_question}
              </p>
            )}
          </>
        )}

        {/* Schedule — proposed assignments, one-click apply */}
        {p.kind === 'schedule_day' && (
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                Ghost would assign
              </p>
              <div className="space-y-1.5">
                {(p.payload.assignments ?? []).map((a, i) => (
                  <div key={i} className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm">
                    <span className="font-semibold text-violet-900">{a.staff_name}</span>
                    <span className="text-violet-700"> — {a.reason}</span>
                  </div>
                ))}
                {!(p.payload.assignments ?? []).length && (
                  <p className="text-sm text-zinc-400">No assignments proposed.</p>
                )}
              </div>
            </div>

            {/* Reality afterwards — the learning signal from the evaluation sweep */}
            {p.outcome?.agreement && (
              <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
                  What actually happened ({p.outcome.agreement.matched}/{p.outcome.agreement.total} matched)
                </p>
                <ul className="space-y-0.5">
                  {p.outcome.agreement.details.map((d, i) => (
                    <li key={i} className={`text-xs ${d.matched ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {d.matched ? '✓' : '✗'} Ghost: {d.proposed_name ?? '—'} · you: {d.actual_name ?? 'nobody'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.status === 'executed' ? (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Applied
                {p.outcome?.applied ? ` · ${p.outcome.applied.length} assigned` : ''}
                {p.outcome?.applied_at ? ` · ${formatAmsterdamTime(p.outcome.applied_at)}` : ''}
              </p>
            ) : p.status === 'expired' ? null : (p.payload.assignments ?? []).length > 0 ? (
              <button
                onClick={() => {
                  if (!confirmSend) { setConfirmSend(true); return }
                  act('apply_schedule')
                }}
                disabled={busy === 'apply_schedule'}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                  confirmSend ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                {busy === 'apply_schedule' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {confirmSend ? 'Confirm — assign these captains' : 'Approve & assign captains'}
              </button>
            ) : null}
          </div>
        )}

        {/* Catering — consolidated orders */}
        {p.kind === 'catering_order' && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
              Ghost would order
            </p>
            <div className="space-y-1.5">
              {(p.payload.orders ?? []).map((o, i) => (
                <div key={i} className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm text-violet-900">
                  <span className="font-semibold">{o.date}</span>
                  {o.urgent_unsent > 0 && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
                      {o.urgent_unsent} not sent
                    </span>
                  )}
                  <span className="block mt-0.5">
                    {o.items.map(it => `${it.quantity}× ${it.name}`).join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Maintenance — priority, photo read-outs, the drafted technician email */}
        {p.kind === 'maintenance_task' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {p.payload.priority && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${MAINT_BADGE[p.payload.priority] ?? 'bg-zinc-100 text-zinc-600'}`}>
                  {MAINT_LABEL[p.payload.priority] ?? p.payload.priority}
                </span>
              )}
              <span className="text-sm font-medium text-zinc-800">{p.payload.title ?? '—'}</span>
            </div>

            {p.payload.summary && <p className="text-sm text-zinc-600">{p.payload.summary}</p>}

            {(p.payload.photo_descriptions?.length ?? 0) > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
                  What the photos show
                </p>
                <ul className="space-y-1">
                  {p.payload.photo_descriptions!.map((d, i) => (
                    <li key={i} className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5">
                      📷 {d}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {p.payload.email_body && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                  Ghost would email the technician
                </p>
                <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm text-violet-900">
                  {p.payload.email_subject && (
                    <p className="font-semibold mb-1">{p.payload.email_subject}</p>
                  )}
                  <p className="whitespace-pre-wrap">{p.payload.email_body}</p>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  To: {p.payload.recipient ?? 'set MAINTENANCE_EMAIL_RECIPIENT'} · sending stays human-approved (one click below).
                </p>
              </div>
            )}

            {/* Approve & send — the only outward action, two-step confirm */}
            {p.status === 'executed' ? (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Email sent
                {p.outcome?.sent_at ? ` · ${formatAmsterdamTime(p.outcome.sent_at)}` : ''}
              </p>
            ) : p.payload.email_body ? (
              <button
                onClick={() => {
                  if (!confirmSend) { setConfirmSend(true); return }
                  act('send')
                }}
                disabled={busy === 'send'}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                  confirmSend ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {confirmSend ? 'Confirm — send email' : 'Approve & send email'}
              </button>
            ) : null}
          </div>
        )}

        {/* Stock reorder — items low, the drafted supplier email, one-click send */}
        {p.kind === 'stock_reorder' && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              {p.payload.urgency && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${
                  p.payload.urgency === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {p.payload.urgency === 'urgent' ? 'Out of stock' : 'Running low'}
                </span>
              )}
              <span className="text-sm font-medium text-zinc-800">
                {p.payload.supplier_name ? `Reorder from ${p.payload.supplier_name}` : 'Stock reorder'}
              </span>
            </div>

            {(p.payload.items?.length ?? 0) > 0 && (
              <ul className="space-y-1">
                {p.payload.items!.map((it, i) => (
                  <li key={i} className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-1.5">
                    {it.quantity ? `${it.quantity}× ` : ''}{it.name}{it.unit ? ` ${it.unit}` : ''}
                    {it.pack_size && it.pack_unit ? ` · ${it.pack_size} ${it.pack_unit} each` : ''}
                  </li>
                ))}
              </ul>
            )}

            {p.payload.email_body && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                  Ghost would email the supplier
                </p>
                <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm text-violet-900">
                  {p.payload.email_subject && (
                    <p className="font-semibold mb-1">{p.payload.email_subject}</p>
                  )}
                  <p className="whitespace-pre-wrap">{p.payload.email_body}</p>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  To: {p.payload.recipient ?? 'set STOCK_EMAIL_RECIPIENT'} · sending stays human-approved (one click below).
                </p>
              </div>
            )}

            {/* Approve & send — same two-step confirm as maintenance */}
            {p.status === 'executed' ? (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Email sent
                {p.outcome?.sent_at ? ` · ${formatAmsterdamTime(p.outcome.sent_at)}` : ''}
              </p>
            ) : p.payload.email_body ? (
              <button
                onClick={() => {
                  if (!confirmSend) { setConfirmSend(true); return }
                  act('send')
                }}
                disabled={busy === 'send'}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                  confirmSend ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {confirmSend ? 'Confirm — send email' : 'Approve & send email'}
              </button>
            ) : null}
          </div>
        )}

        {/* Operations review — tomorrow's plan, scored and explained */}
        {p.kind === 'ops_review' && (
          <div className="space-y-3">
            {p.payload.facts && (
              <p className="text-xs text-zinc-500">
                {p.payload.facts.boats_in_use?.join(' + ') ?? '—'} on the water
                {typeof p.payload.facts.open_shifts === 'number' && p.payload.facts.open_shifts > 0 && (
                  <span className="text-amber-600 font-medium"> · {p.payload.facts.open_shifts} shift{p.payload.facts.open_shifts === 1 ? '' : 's'} without captain</span>
                )}
                {typeof p.payload.facts.total_idle_minutes === 'number' && p.payload.facts.total_idle_minutes > 0 && (
                  <> · {p.payload.facts.total_idle_minutes} min idle ≈ €{((p.payload.facts.total_est_idle_cost_cents ?? 0) / 100).toFixed(0)}</>
                )}
              </p>
            )}
            <div className="space-y-1.5">
              {(p.payload.recommendations ?? []).map((r, i) => (
                <div key={i} className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wide ${OPS_REC_BADGE[r.type] ?? 'bg-zinc-100 text-zinc-600'}`}>
                      {OPS_REC_LABEL[r.type] ?? r.type}
                    </span>
                    <span className="font-semibold text-violet-900">{r.summary}</span>
                    {r.est_saving_cents > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                        saves €{(r.est_saving_cents / 100).toFixed(0)}
                      </span>
                    )}
                    {r.requires_guest_contact && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">
                        needs guest contact
                      </span>
                    )}
                  </div>
                  <p className="text-violet-700 mt-1">{r.why}</p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    guest impact: {r.guest_impact} · confidence {Math.round(r.confidence * 100)}%
                  </p>
                </div>
              ))}
              {!(p.payload.recommendations ?? []).length && (
                <p className="text-sm text-zinc-400">No recommendations.</p>
              )}
            </div>
          </div>
        )}

        {/* Guest move request — the ask, the drafted messages, the answer */}
        {p.kind === 'guest_move_request' && (
          <div className="space-y-3">
            <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm">
              <p className="font-semibold text-violet-900">
                {p.payload.guest_name ?? 'Guest'} · {p.payload.cruise_title ?? 'cruise'} · {p.payload.target_date}
              </p>
              <p className="text-violet-700 mt-0.5">
                {p.payload.current_start_at ? formatAmsterdamTime(p.payload.current_start_at) : '?'}
                {' → '}
                <span className="font-semibold">{p.payload.proposed_start_at ? formatAmsterdamTime(p.payload.proposed_start_at) : '?'}</span>
                {p.payload.boat ? ` · same boat (${p.payload.boat})` : ''}
                {typeof p.payload.est_saving_cents === 'number' && (
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">
                    saves €{(p.payload.est_saving_cents / 100).toFixed(0)}
                  </span>
                )}
              </p>
              {p.payload.incentive && <p className="text-xs text-violet-600 mt-0.5">🍷 offer: {p.payload.incentive}</p>}
            </div>

            {p.payload.sms_text && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                  SMS ({p.payload.guest_phone ?? 'no phone on booking'})
                </p>
                <p className="rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-xs text-zinc-700 whitespace-pre-wrap">
                  {p.payload.sms_text}
                </p>
              </div>
            )}
            {p.payload.email_body && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                  Email ({p.payload.guest_email ?? 'no email on booking'})
                </p>
                <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-xs text-zinc-700">
                  {p.payload.email_subject && <p className="font-semibold mb-1">{p.payload.email_subject}</p>}
                  <p className="whitespace-pre-wrap">{p.payload.email_body}</p>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  {'{{link}}'} becomes the guest&apos;s personal response page (Yes / Let me check / Keep my time).
                </p>
              </div>
            )}

            {/* Answer status, or the send button */}
            {p.outcome?.guest_response ? (
              <p className={`text-xs rounded-lg px-3 py-2 inline-flex items-center gap-1.5 border ${
                p.outcome.guest_response === 'accept'
                  ? 'text-emerald-700 bg-emerald-50 border-emerald-100'
                  : p.outcome.guest_response === 'decline'
                    ? 'text-zinc-600 bg-zinc-50 border-zinc-200'
                    : 'text-amber-700 bg-amber-50 border-amber-100'
              }`}>
                <CheckCircle2 className="w-3.5 h-3.5" />
                Guest answered: {p.outcome.guest_response === 'accept' ? 'Yes, that\'s fine — rebook in FareHarbor now' : p.outcome.guest_response === 'decline' ? 'keeps the original time' : 'is checking'}
                {p.outcome.responded_at ? ` · ${formatAmsterdamTime(p.outcome.responded_at)}` : ''}
              </p>
            ) : p.status === 'approved' ? (
              <p className="text-xs text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                <Send className="w-3.5 h-3.5" /> Sent via {(p.outcome?.channels ?? []).join(' + ') || '—'}
                {p.outcome?.sent_at ? ` · ${formatAmsterdamTime(p.outcome.sent_at)}` : ''} · awaiting the guest
              </p>
            ) : p.status === 'expired' ? (
              <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 inline-block">
                Expired without an answer — original time kept.
              </p>
            ) : (
              <button
                onClick={() => {
                  if (!confirmSend) { setConfirmSend(true); return }
                  act('send_move')
                }}
                disabled={busy === 'send_move'}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                  confirmSend ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                {busy === 'send_move' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {confirmSend ? 'Confirm — text & email the guest' : 'Approve & contact guest'}
              </button>
            )}
          </div>
        )}

        {/* Snackbox upsell — drinks-only guest, drafted offer email, one-click send */}
        {p.kind === 'catering_upsell' && (
          <div className="space-y-3">
            <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm">
              <p className="font-semibold text-violet-900">
                {p.payload.guest_name ?? 'Guest'} · {p.payload.cruise_title ?? 'cruise'} · {p.payload.target_date}
                {p.payload.guest_count ? ` · ${p.payload.guest_count} guests` : ''}
              </p>
              <p className="text-violet-700 mt-0.5">Drinks sorted (unlimited package) — nothing to eat aboard yet.</p>
            </div>

            {p.payload.email_body && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                  Ghost would email the guest ({p.payload.recipient ?? 'no email'})
                </p>
                <div className="rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-xs text-zinc-700">
                  {p.payload.email_subject && <p className="font-semibold mb-1">{p.payload.email_subject}</p>}
                  <p className="whitespace-pre-wrap">{p.payload.email_body}</p>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  The link is their existing pre-order page — no payment until the day. Sending stays human-approved.
                </p>
              </div>
            )}

            {p.status === 'executed' ? (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 inline-flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" /> Offer sent
                {p.outcome?.sent_at ? ` · ${formatAmsterdamTime(p.outcome.sent_at)}` : ''}
              </p>
            ) : p.payload.email_body ? (
              <button
                onClick={() => {
                  if (!confirmSend) { setConfirmSend(true); return }
                  act('send')
                }}
                disabled={busy === 'send'}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${
                  confirmSend ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-zinc-900 text-white hover:bg-zinc-800'
                }`}
              >
                {busy === 'send' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {confirmSend ? 'Confirm — email the guest' : 'Approve & send offer'}
              </button>
            ) : null}
          </div>
        )}

        {/* Why — every proposal explains itself */}
        {p.reasoning && (
          <p className="text-xs text-zinc-500">
            <span className="font-semibold text-zinc-600">Reasoning:</span> {p.reasoning}
          </p>
        )}

        {/* Actions — review triage + re-draft */}
        <div className="flex items-center gap-2 pt-2 border-t border-zinc-100">
          <button
            onClick={() => act('review', { reviewed: !reviewed })}
            disabled={busy === 'review'}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md transition-colors disabled:opacity-50 ${
              reviewed ? 'text-emerald-600 hover:bg-emerald-50' : 'text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            {busy === 'review' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : reviewed ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Circle className="w-3.5 h-3.5" />
            )}
            {reviewed ? 'Reviewed' : 'Mark reviewed'}
          </button>
          {conversational && (
            <button
              onClick={() => act('redraft')}
              disabled={busy === 'redraft'}
              title="Re-run the agent for this conversation — e.g. after you teach it something"
              className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md text-zinc-500 hover:bg-zinc-100 transition-colors disabled:opacity-50"
            >
              {busy === 'redraft' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Re-draft
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
