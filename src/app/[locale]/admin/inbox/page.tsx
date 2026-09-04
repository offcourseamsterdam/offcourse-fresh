'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Ghost, Loader2, X } from 'lucide-react'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { ConversationList, type StatusFilter } from './ConversationList'
import { ThreadPane } from './ThreadPane'
import { ContextPane } from './ContextPane'
import { CallButton } from './CallButton'
import { UploadInvoiceModal } from './UploadInvoiceModal'
import { hasGhostCoPilotContent, type InboxConversationDetail, type InboxListItem } from './types'

/**
 * The unified inbox — three panes on desktop (list · thread · customer),
 * drill-in on mobile (list → thread), per docs/plans/unified-inbox-and-comms.md §8.
 * Webchat is the first channel; email/WhatsApp/voice plug into the same panes later.
 */

const LIST_POLL_MS = 10_000
const THREAD_POLL_MS = 5_000

export default function AdminInboxPage() {
  // ?c=<conversationId> opens that thread directly — the Slack DM (and any
  // other deep link) points here, so the link lands on the actual conversation
  // instead of dumping you in the list to hunt for it. Only the INITIAL value:
  // clicking another thread afterwards must not be fought by the URL.
  const searchParams = useSearchParams()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => (searchParams.get('c') ? 'all' : 'open'))
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('c'))
  // "Use this draft" in the Ghost co-pilot drops text into the thread composer.
  const [composerPrefill, setComposerPrefill] = useState<string | null>(null)
  // Below xl, the customer/Ghost pane isn't docked beside the thread — it opens
  // as a bottom drawer instead, so it's still reachable on tablet/mobile widths.
  const [mobileContextOpen, setMobileContextOpen] = useState(false)

  const list = useAdminFetch<{ conversations: InboxListItem[] }>(
    `/api/admin/inbox/conversations?status=${statusFilter}`,
    { refreshInterval: LIST_POLL_MS },
  )
  const detail = useAdminFetch<InboxConversationDetail>(
    selectedId ? `/api/admin/inbox/conversations/${selectedId}` : null,
    { refreshInterval: THREAD_POLL_MS },
  )

  const conversations = list.data?.conversations ?? []
  const ghost = detail.data?.ghost
  const hasGhostAction = hasGhostCoPilotContent(ghost)

  function refreshAll() {
    detail.refresh()
    list.refresh()
  }

  function selectConversation(id: string | null) {
    setSelectedId(id)
    setMobileContextOpen(false)
  }

  return (
    <div className="p-4 sm:p-6 h-[calc(100vh-0px)] flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Inbox</h1>
          <p className="text-sm text-zinc-500 mt-1">Every customer conversation, one place.</p>
        </div>
        <div className="flex items-center gap-2">
          <UploadInvoiceModal
            onUploaded={id => {
              // Setting these two triggers useAdminFetch's own URL-driven
              // refetch for both panes — no explicit refresh() call needed,
              // same as onFilterChange below.
              setStatusFilter('all')
              selectConversation(id)
            }}
          />
          <CallButton />
        </div>
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
              onSelect={selectConversation}
              onFilterChange={f => {
                setStatusFilter(f)
                selectConversation(null)
              }}
              onStatusChanged={refreshAll}
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
                onBack={() => selectConversation(null)}
                prefill={composerPrefill}
                onPrefillConsumed={() => setComposerPrefill(null)}
                onOpenContext={() => setMobileContextOpen(true)}
                contextHasAction={hasGhostAction}
              />
            )}
          </div>

          {/* Right — customer context, docked from xl up */}
          {selectedId && detail.data && (
            <div className="hidden xl:block w-72 border-l border-zinc-100 shrink-0">
              <ContextPane detail={detail.data} onChanged={refreshAll} onUseDraft={setComposerPrefill} />
            </div>
          )}
        </div>
      )}

      {/* Below xl, the same pane opens as a bottom drawer instead of being docked. */}
      {mobileContextOpen && selectedId && detail.data && (
        <div className="xl:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileContextOpen(false)} />
          <div className="relative bg-white rounded-t-2xl shadow-xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 shrink-0">
              <p className="text-sm font-semibold text-zinc-900 flex items-center gap-1.5">
                <Ghost className="w-4 h-4 text-violet-500" /> Details
              </p>
              <button
                onClick={() => setMobileContextOpen(false)}
                aria-label="Close"
                className="p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ContextPane
                detail={detail.data}
                onChanged={refreshAll}
                onUseDraft={text => {
                  setComposerPrefill(text)
                  setMobileContextOpen(false)
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
