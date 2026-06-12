'use client'

import { CalendarClock, Euro, Ghost, Loader2, UtensilsCrossed } from 'lucide-react'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { formatAmsterdamTime } from '@/lib/utils'

/**
 * The Ghost AI's notebook — shadow-mode proposals, read-only.
 * Reply drafts (per inbound chat message) + daily ops drafts (tomorrow's
 * captain schedule, upcoming catering orders). Nothing here is ever shown
 * to customers or executed; this page is where the Ghost earns trust.
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

interface GhostProposal {
  id: string
  kind: string
  payload: {
    reply?: string
    language?: string
    target_date?: string
    assignments?: ScheduleAssignment[]
    orders?: CateringOrder[]
  }
  reasoning: string | null
  status: string
  model: string | null
  created_at: string
  conversation: {
    id: string
    channel: string
    contact: { name: string; email: string | null; locale: string | null } | null
  } | null
  trigger: { body: string; author_name: string | null; created_at: string } | null
}

interface SpendSummary {
  totalEur: number
  last30dEur: number
  calls: number
}

const POLL_MS = 15_000

export default function GhostPage() {
  const { data, isLoading, error } = useAdminFetch<{ proposals: GhostProposal[]; spend: SpendSummary }>(
    '/api/admin/ghost',
    { refreshInterval: POLL_MS },
  )
  const proposals = data?.proposals ?? []
  const spend = data?.spend

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900 inline-flex items-center gap-2">
            <Ghost className="w-6 h-6 text-violet-500" /> Ghost AI
          </h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-xl">
            Shadow mode — reply drafts, tomorrow&apos;s schedule and catering orders, all logged but
            never executed. Compare against what you actually did. Trust is earned here first.
          </p>
        </div>

        {/* The fuel gauge — every AI call is metered; €5 steps DM Beer on Slack. */}
        {spend && (
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 inline-flex items-center gap-1">
              <Euro className="w-3 h-3" /> AI spend
            </p>
            <p className="text-lg font-semibold text-zinc-900 leading-tight">
              €{spend.totalEur.toFixed(2)}
            </p>
            <p className="text-[11px] text-zinc-400">
              €{spend.last30dEur.toFixed(2)} last 30d · {spend.calls} calls · alert every €5
            </p>
          </div>
        )}
      </div>

      <AdminErrorBanner error={error} />

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
          <ProposalCard key={p.id} proposal={p} />
        ))}
      </div>
    </div>
  )
}

const KIND_META: Record<string, { label: string; Icon: typeof Ghost }> = {
  reply_draft: { label: 'Reply draft', Icon: Ghost },
  schedule_day: { label: 'Schedule', Icon: CalendarClock },
  catering_order: { label: 'Catering', Icon: UtensilsCrossed },
}

function ProposalCard({ proposal: p }: { proposal: GhostProposal }) {
  const meta = KIND_META[p.kind] ?? { label: p.kind, Icon: Ghost }

  return (
    <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60">
        <div className="flex items-center gap-2 min-w-0">
          <meta.Icon className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="text-xs font-semibold text-violet-600 uppercase tracking-wide">{meta.label}</span>
          {p.kind === 'reply_draft' ? (
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
        {/* Reply draft — customer message + draft */}
        {p.kind === 'reply_draft' && (
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
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                Ghost would reply
              </p>
              <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm text-violet-900 whitespace-pre-wrap">
                {p.payload.reply ?? '—'}
              </div>
            </div>
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
