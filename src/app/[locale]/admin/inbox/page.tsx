'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { ConversationList, type StatusFilter } from './ConversationList'
import { ThreadPane } from './ThreadPane'
import { ContextPane } from './ContextPane'
import type { InboxConversationDetail, InboxListItem } from './types'

/**
 * The unified inbox — three panes on desktop (list · thread · customer),
 * drill-in on mobile (list → thread), per docs/plans/unified-inbox-and-comms.md §8.
 * Webchat is the first channel; email/WhatsApp/voice plug into the same panes later.
 */

const LIST_POLL_MS = 10_000
const THREAD_POLL_MS = 5_000

export default function AdminInboxPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // "Use this draft" in the Ghost co-pilot drops text into the thread composer.
  const [composerPrefill, setComposerPrefill] = useState<string | null>(null)

  const list = useAdminFetch<{ conversations: InboxListItem[] }>(
    `/api/admin/inbox/conversations?status=${statusFilter}`,
    { refreshInterval: LIST_POLL_MS },
  )
  const detail = useAdminFetch<InboxConversationDetail>(
    selectedId ? `/api/admin/inbox/conversations/${selectedId}` : null,
    { refreshInterval: THREAD_POLL_MS },
  )

  const conversations = list.data?.conversations ?? []

  function refreshAll() {
    detail.refresh()
    list.refresh()
  }

  return (
    <div className="p-4 sm:p-6 h-[calc(100vh-0px)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold text-zinc-900">Inbox</h1>
        <p className="text-sm text-zinc-500 mt-1">Every customer conversation, one place.</p>
      </div>

      <AdminErrorBanner error={list.error ?? detail.error} />

      {list.isLoading && !list.data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading inbox…
        </div>
      )}

      {list.data && (
        <div className="flex-1 min-h-0 bg-white rounded-xl border border-zinc-200 overflow-hidden flex">
          {/* Left — list. On mobile hidden while a thread is open (drill-in). */}
          <div
            className={`w-full lg:w-72 xl:w-80 lg:border-r border-zinc-100 shrink-0 ${selectedId ? 'hidden lg:block' : ''}`}
          >
            <ConversationList
              conversations={conversations}
              selectedId={selectedId}
              statusFilter={statusFilter}
              onSelect={setSelectedId}
              onFilterChange={f => {
                setStatusFilter(f)
                setSelectedId(null)
              }}
            />
          </div>

          {/* Middle — thread */}
          <div className={`flex-1 min-w-0 ${selectedId ? '' : 'hidden lg:flex lg:items-center lg:justify-center'}`}>
            {!selectedId && <p className="text-sm text-zinc-400">Pick a conversation</p>}
            {selectedId && !detail.data && (
              <div className="flex items-center justify-center h-full text-zinc-400">
                <Loader2 className="w-4 h-4 animate-spin" />
              </div>
            )}
            {selectedId && detail.data && (
              <ThreadPane
                detail={detail.data}
                onSent={refreshAll}
                onBack={() => setSelectedId(null)}
                prefill={composerPrefill}
                onPrefillConsumed={() => setComposerPrefill(null)}
              />
            )}
          </div>

          {/* Right — customer context (desktop only; xl) */}
          {selectedId && detail.data && (
            <div className="hidden xl:block w-72 border-l border-zinc-100 shrink-0">
              <ContextPane detail={detail.data} onChanged={refreshAll} onUseDraft={setComposerPrefill} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
