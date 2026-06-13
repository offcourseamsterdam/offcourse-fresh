'use client'

import { useState } from 'react'
import {
  BookOpen,
  CalendarClock,
  CalendarPlus,
  Euro,
  Ghost,
  HelpCircle,
  Inbox,
  Loader2,
  Package,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { adminMutate } from '@/hooks/useAdminSave'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { GHOST_AGENTS, agentForKind, agentAutonomy } from '@/lib/ghost/agents'
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
  }
  reasoning: string | null
  status: string
  model: string | null
  outcome: { human_reply?: string; replied_by?: string; replied_at?: string } | null
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
  spend: { totalEur: number; last30dEur: number; calls: number }
  stats: {
    total: number
    byKind: Record<string, number>
    corrected: number
    awaitingComparison: number
    openQuestions: number
    knowledgeEntries: number
  }
  openQuestions: { proposal_id: string; question: string; created_at: string }[]
  knowledge: { id: string; question: string; answer: string; pinned: boolean; created_at: string }[]
}

const POLL_MS = 15_000

export default function GhostPage() {
  const { data, isLoading, error, refresh } = useAdminFetch<GhostData>('/api/admin/ghost', {
    refreshInterval: POLL_MS,
  })
  const [agentFilter, setAgentFilter] = useState<string | null>(null)

  const allProposals = data?.proposals ?? []
  const proposals = agentFilter
    ? allProposals.filter(p => agentForKind(p.kind)?.key === agentFilter)
    : allProposals

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
            <Ghost className="w-6 h-6 text-violet-500" /> Ghost AI
          </h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            Shadow mode — drafts logged, never executed. It learns from your real replies and from
            the questions you answer below.
          </p>
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
          <StatCard label="Proposals" value={data.stats.total} sub={Object.entries(data.stats.byKind).map(([k, n]) => `${n} ${KIND_META[k]?.label?.toLowerCase() ?? k}`).join(' · ')} />
          <StatCard label="Corrected by you" value={data.stats.corrected} sub={`${data.stats.awaitingComparison} awaiting your reply`} accent="violet" />
          <StatCard label="Open questions" value={data.stats.openQuestions} sub="answer them below" accent={data.stats.openQuestions > 0 ? 'amber' : undefined} />
          <StatCard label="Things taught" value={data.stats.knowledgeEntries} sub="in every future draft" accent="emerald" />
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
                onClick={() => !planned && setAgentFilter(f => (f === agent.key ? null : agent.key))}
                disabled={planned}
                title={agent.description}
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

      {data && proposals.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-300 p-10 text-center">
          <Ghost className="w-8 h-8 text-zinc-300 mx-auto mb-3" />
          <p className="text-sm text-zinc-500">
            Nothing yet — the Ghost wakes up on customer messages and the daily ops cron.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {proposals.map(p => (
          <ProposalCard key={p.id} proposal={p} onChanged={refresh} />
        ))}
      </div>

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
  questions: { proposal_id: string; question: string; created_at: string }[]
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
}

const KIND_META: Record<string, { label: string; Icon: typeof Ghost }> = {
  reply_draft: { label: 'Reply draft', Icon: Inbox },
  booking_proposal: { label: 'Booking', Icon: CalendarPlus },
  schedule_day: { label: 'Schedule', Icon: CalendarClock },
  catering_order: { label: 'Catering', Icon: UtensilsCrossed },
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

function ProposalCard({ proposal: p, onChanged }: { proposal: GhostProposal; onChanged: () => void }) {
  const meta = KIND_META[p.kind] ?? { label: p.kind, Icon: Ghost }
  const agent = agentForKind(p.kind)
  const conversational = p.kind === 'reply_draft' || p.kind === 'booking_proposal'

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
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
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600 mb-1">
                  {p.outcome.replied_by ?? 'You'} actually replied
                </p>
                <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-sm text-emerald-900 whitespace-pre-wrap">
                  {p.outcome.human_reply}
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  This pair is now a lesson — the Ghost sees it in future drafts.
                </p>
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

        {/* Schedule — proposed assignments */}
        {p.kind === 'schedule_day' && (
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

        {/* Why — every proposal explains itself */}
        {p.reasoning && (
          <p className="text-xs text-zinc-500">
            <span className="font-semibold text-zinc-600">Reasoning:</span> {p.reasoning}
          </p>
        )}
      </div>
    </div>
  )
}
