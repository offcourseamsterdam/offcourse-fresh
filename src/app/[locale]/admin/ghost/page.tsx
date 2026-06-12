'use client'

import { Ghost, Loader2 } from 'lucide-react'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { formatAmsterdamTime } from '@/lib/utils'

/**
 * The Ghost AI's notebook — shadow-mode proposals, read-only.
 * Every inbound chat message makes the Ghost draft what IT would have
 * replied; this page shows those drafts so we can compare them against
 * what the humans actually sent. Nothing here is ever shown to customers.
 */

interface GhostProposal {
  id: string
  kind: string
  payload: { reply?: string; language?: string }
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

const POLL_MS = 15_000

export default function GhostPage() {
  const { data, isLoading, error } = useAdminFetch<{ proposals: GhostProposal[] }>(
    '/api/admin/ghost',
    { refreshInterval: POLL_MS },
  )
  const proposals = data?.proposals ?? []

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-zinc-900 inline-flex items-center gap-2">
          <Ghost className="w-6 h-6 text-violet-500" /> Ghost AI
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          Shadow mode — the AI drafts a reply for every inbound chat message, but nothing is ever
          sent. Compare its drafts against what you actually replied. Trust is earned here first.
        </p>
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
            Nothing yet — the Ghost wakes up when the next customer message arrives.
          </p>
        </div>
      )}

      <div className="space-y-4">
        {proposals.map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium text-zinc-800 truncate">
                  {p.conversation?.contact?.name ?? 'Unknown'}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-zinc-400">
                  {p.conversation?.channel ?? ''}
                </span>
                {p.payload.language && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 font-medium">
                    {p.payload.language}
                  </span>
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
              {/* What the customer said */}
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

              {/* What the Ghost would reply */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500 mb-1">
                  Ghost would reply
                </p>
                <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 text-sm text-violet-900 whitespace-pre-wrap">
                  {p.payload.reply ?? '—'}
                </div>
              </div>

              {/* Why */}
              {p.reasoning && (
                <p className="text-xs text-zinc-500">
                  <span className="font-semibold text-zinc-600">Reasoning:</span> {p.reasoning}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
