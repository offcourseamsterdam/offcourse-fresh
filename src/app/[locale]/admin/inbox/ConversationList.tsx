'use client'

import { useMemo, useState, type ComponentType } from 'react'
import { preload } from 'swr'
import { CheckCircle2, Clock, Download, Globe, Mail, MailOpen, MessageSquare, Phone, XCircle } from 'lucide-react'
import { timeAgoShort } from '@/lib/utils'
import { fmtAdminDate, fmtAdminTime } from '@/lib/admin/format'
import { formatWindowRemaining } from '@/lib/whatsapp/window'
import { WhatsAppIcon } from '@/components/chat/WhatsAppIcon'
import { adminFetcher } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { useTickingClock } from '@/hooks/useTickingClock'
import { OTA_PLATFORM_NAME } from '@/lib/ota/detect'
import { GYG_REVIEW_NOTIFICATION_SENDER } from '@/lib/getyourguide/detect-review-notification'
import type { InboxListItem } from './types'

/** Same idiom as DashboardSidebar's nav hover-prefetch — warm SWR's cache the
 * moment the mouse arrives on a row, so by the time a click actually lands,
 * the thread detail request is already in flight (or done). */
function prefetchConversation(id: string) {
  preload(`/api/admin/inbox/conversations/${id}`, adminFetcher)
}

const CHANNEL_ICON = {
  webchat: MessageSquare,
  email: Mail,
  whatsapp: WhatsAppIcon,
  voice: Phone,
} as const

export const STATUS_FILTERS = ['open', 'pending', 'resolved', 'all'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]
const STATUS_LABELS: Record<StatusFilter, string> = { open: 'Open', pending: 'Waiting', resolved: 'Resolved', all: 'All' }

/** A conversation's actual workflow status (no 'all' — that's a filter, not a real state). */
const WORKFLOW_STATUSES = ['open', 'pending', 'resolved'] as const
type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]
const WORKFLOW_ICON: Record<WorkflowStatus, typeof Mail> = { open: MailOpen, pending: Clock, resolved: CheckCircle2 }

/**
 * Which bucket a conversation belongs to for the source-filter pill. OTA
 * (Withlocals/GetMyBoat notifications) is checked first since it's carried
 * on the email channel but is never a real customer conversation — see
 * ota/detect.ts. Every real channel gets its own bucket (webchat = "Chat")
 * so Beer can see volume per channel at a glance, including phone calls.
 *
 * No 'finance' bucket here: a finance-category conversation never reaches
 * this list at all — /admin/inbox and /admin/finance/inbox are now two
 * separate desks, each backed by its own scoped query (see
 * api/admin/inbox/conversations/route.ts's applyInboxScope).
 */
const SOURCE_FILTERS = ['chat', 'email', 'whatsapp', 'voice', 'ota'] as const
type SourceFilter = (typeof SOURCE_FILTERS)[number]
const SOURCE_LABELS: Record<SourceFilter, string> = { chat: 'Chat', email: 'Email', whatsapp: 'WhatsApp', voice: 'Voice', ota: 'OTA' }
// Globe (not Hourglass) here — Hourglass is reserved for a row's "waiting" status; this icon means "this category is OTA platforms", not any status.
const SOURCE_ICON: Record<SourceFilter, ComponentType<{ className?: string }>> = {
  chat: MessageSquare,
  email: Mail,
  whatsapp: WhatsAppIcon,
  voice: Phone,
  ota: Globe,
}
function sourceOf(c: InboxListItem): SourceFilter {
  if (c.ota_source) return 'ota'
  if (c.channel === 'email' || c.channel === 'whatsapp' || c.channel === 'voice') return c.channel
  return 'chat'
}

/**
 * "Booking request" / "Booking confirmed" above the name, instead of making
 * Beer read "Withlocals" (the platform's own relay address, not a customer)
 * and infer what kind of message this is from the snippet. Only built for
 * what's actually classified today — a "Cancellation request" type would
 * need its own detector grounded in a real example first, same rule as
 * everything else in ota/detect.ts.
 */
function requestTypeLabel(c: InboxListItem): string | null {
  // GetYourGuide's own review-notification relay — never a customer, never
  // has a booking, so without this it fell through to bookingInfoLabel()'s
  // generic "no booking" (see gmail/sync.ts's handleGygReviewNotification,
  // which deliberately does NOT stamp ota_source — that field also drives the
  // OTA filter bucket, and a review notification is neither an OTA booking
  // request nor something to reply to).
  // No platform suffix here (unlike the OTA labels below) — the contact name
  // for this sender IS "GetYourGuide", so "New review · GetYourGuide" would
  // repeat it right after: "New review · GetYourGuide — GetYourGuide".
  if (c.contact?.email === GYG_REVIEW_NOTIFICATION_SENDER) return 'New review'
  if (c.ota_source) {
    const platform = OTA_PLATFORM_NAME[c.ota_source as keyof typeof OTA_PLATFORM_NAME] ?? c.ota_source
    const kind =
      c.ota_status === 'confirmed'
        ? 'Booking confirmed'
        : c.ota_status === 'needs_import'
          ? 'Not in our database'
          : c.ota_status === 'imported'
            ? 'Imported'
            : c.ota_status === 'sync_mismatch'
              ? 'Website booking — no DB row'
              : 'Booking request'
    return `${kind} · ${platform}`
  }
  if (c.is_catering_thread) return 'Catering reply'
  return null
}

/**
 * For a real customer (not an OTA/catering row, which already have their own
 * label above) — a quick "is there an actual booking behind this name" tell,
 * so Beer doesn't have to open every thread to find out. Shows the soonest
 * upcoming booking, or the most recent past one if none is upcoming.
 */
function bookingInfoLabel(c: InboxListItem): string {
  if (!c.next_booking) return 'no booking'
  const { date, time } = c.next_booking
  return time ? `${fmtAdminDate(date)}, ${fmtAdminTime(time)}` : fmtAdminDate(date)
}

interface Props {
  conversations: InboxListItem[]
  selectedId: string | null
  statusFilter: StatusFilter
  onSelect: (id: string) => void
  onFilterChange: (f: StatusFilter) => void
  /** Called after a row's quick-action status change saves, so the parent can refetch. */
  onStatusChanged?: () => void
}

/** Left pane — every conversation across all channels, newest activity first. */
export function ConversationList({ conversations, selectedId, statusFilter, onSelect, onFilterChange, onStatusChanged }: Props) {
  // Ticks the WhatsApp window badges below — the list itself re-polls every
  // 10s anyway (page.tsx), but a visible countdown should move even between
  // polls rather than sitting frozen for up to 10s at a time.
  const now = useTickingClock(true)

  // Quick status-change buttons on each row (Open/Waiting/Resolved) — disabled
  // while its own request is in flight so a slow save can't be double-fired.
  const [changingId, setChangingId] = useState<string | null>(null)
  // Drives the row's fade/slide-out below. Separate from changingId (which
  // gates re-entrancy) so the animation has a guaranteed minimum duration
  // instead of just however long the network happens to take — a save that
  // resolves in 80ms would otherwise look like a jump-cut, not a transition.
  const [animatingId, setAnimatingId] = useState<string | null>(null)
  const [animatingStatus, setAnimatingStatus] = useState<WorkflowStatus | null>(null)
  const ROW_ANIMATION_MS = 320
  async function changeStatus(id: string, status: WorkflowStatus) {
    if (changingId) return
    setChangingId(id)
    setAnimatingId(id)
    setAnimatingStatus(status)
    try {
      await Promise.all([
        adminMutate(`/api/admin/inbox/conversations/${id}`, 'PATCH', { status }),
        new Promise(resolve => setTimeout(resolve, ROW_ANIMATION_MS)),
      ])
      onStatusChanged?.()
    } finally {
      setChangingId(null)
      setAnimatingId(null)
      setAnimatingStatus(null)
    }
  }

  // All on by default — toggling one off hides that category, doesn't isolate it.
  const [sourceFilter, setSourceFilter] = useState<Record<SourceFilter, boolean>>({
    chat: true,
    email: true,
    whatsapp: true,
    voice: true,
    ota: true,
  })
  // One pass over `conversations` for both derived values instead of two
  // (`reduce` + `filter`), and computed once per render via useMemo instead
  // of on every re-render — this component re-renders every 30s just to
  // tick the WhatsApp countdown badges, which shouldn't force a full
  // recount/refilter of a list that hasn't actually changed.
  const { sourceCounts, visibleConversations } = useMemo(() => {
    const counts: Record<SourceFilter, number> = { chat: 0, email: 0, whatsapp: 0, voice: 0, ota: 0 }
    const visible: typeof conversations = []
    for (const c of conversations) {
      const source = sourceOf(c)
      counts[source]++
      if (sourceFilter[source]) visible.push(c)
    }
    return { sourceCounts: counts, visibleConversations: visible }
  }, [conversations, sourceFilter])

  return (
    <div className="flex flex-col h-full">
      {/* Status filter chips */}
      <div className="flex items-center gap-1 p-2 border-b border-zinc-100">
        {STATUS_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium transition-colors min-h-[32px] ${
              statusFilter === f ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            {STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Source filter — each independently toggleable, in one segmented pill */}
      <div className="flex items-center gap-1 px-2 pb-2 pt-1 border-b border-zinc-100 flex-wrap">
        <div className="inline-flex flex-wrap gap-1 rounded-full bg-zinc-100 p-0.5">
          {SOURCE_FILTERS.map(key => {
            const SourceIcon = SOURCE_ICON[key]
            return (
              <button
                key={key}
                onClick={() => setSourceFilter(prev => ({ ...prev, [key]: !prev[key] }))}
                aria-pressed={sourceFilter[key]}
                title={SOURCE_LABELS[key]}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors min-h-[28px] ${
                  sourceFilter[key] ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-400'
                }`}
              >
                <SourceIcon className="w-3.5 h-3.5" />
                <span className="tabular-nums">{sourceCounts[key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visibleConversations.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-8 px-4">
            No conversations here. The water is calm.
          </p>
        )}
        {visibleConversations.map(c => {
          const ChannelIcon = CHANNEL_ICON[c.channel] ?? MessageSquare
          // Globe/checkmark/download for OTA rows — deliberately NOT Clock,
          // which already means "WhatsApp window countdown" elsewhere in this
          // list. Download = it's already a real FareHarbor booking, just
          // needs pulling into our own database (see ota/detect.ts).
          const Icon = c.ota_source
            ? c.ota_status === 'confirmed' || c.ota_status === 'imported'
              ? CheckCircle2
              : c.ota_status === 'needs_import'
                ? Download
                : c.ota_status === 'sync_mismatch'
                  ? XCircle
                  : Globe
            : ChannelIcon
          const unread = c.unread_count > 0
          const windowStatus = c.channel === 'whatsapp' ? formatWindowRemaining(c.wa_window_expires_at, now) : null
          const otherStatuses = WORKFLOW_STATUSES.filter(s => s !== c.status)
          const requestType = requestTypeLabel(c)
          const displayName = c.ota_guest_name ?? c.contact?.name ?? 'Unknown'
          const isAnimatingOut = animatingId === c.id
          const animatingColor = animatingStatus === 'resolved' ? 'bg-emerald-50' : animatingStatus === 'pending' ? 'bg-amber-50' : ''
          return (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(c.id)}
              onMouseEnter={() => prefetchConversation(c.id)}
              onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSelect(c.id)}
              className={`group w-full text-left px-3 py-3 border-b border-zinc-50 cursor-pointer transition-all duration-300 ease-out ${
                isAnimatingOut
                  ? `opacity-0 scale-[0.97] -translate-x-1.5 ${animatingColor}`
                  : `opacity-100 scale-100 translate-x-0 ${selectedId === c.id ? 'bg-zinc-100' : 'hover:bg-zinc-50'}`
              }`}
            >
              <div className="flex items-center gap-2">
                {isAnimatingOut && animatingStatus ? (
                  (() => {
                    const AnimatingIcon = WORKFLOW_ICON[animatingStatus]
                    return (
                      <AnimatingIcon
                        className={`w-3.5 h-3.5 shrink-0 ${animatingStatus === 'resolved' ? 'text-emerald-500' : 'text-amber-500'}`}
                      />
                    )
                  })()
                ) : (
                  <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                )}
                <span className={`flex-1 min-w-0 flex items-baseline text-sm ${unread ? 'font-semibold text-zinc-900' : 'text-zinc-700'}`}>
                  {/* requestType is fixed-width (shrink-0) so a long label can never push the
                      actual guest name off the end of the shared truncate — before this, a
                      long label like "Website booking — no DB row · Boat Local —" ate the whole
                      row's width and the real name never rendered at all. */}
                  {requestType && <span className="font-normal text-zinc-400 shrink-0 whitespace-nowrap">{requestType} — </span>}
                  <span className="truncate">{displayName}</span>
                  {!requestType && <span className="font-normal text-zinc-400 shrink-0 whitespace-nowrap"> — {bookingInfoLabel(c)}</span>}
                </span>
                {/* Quick status change — icon-only, hidden until hover, only the OTHER two states shown */}
                <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  {otherStatuses.map(s => {
                    const ActionIcon = WORKFLOW_ICON[s]
                    return (
                      <button
                        key={s}
                        title={`Mark ${STATUS_LABELS[s]}`}
                        disabled={changingId === c.id}
                        onClick={e => {
                          e.stopPropagation()
                          changeStatus(c.id, s)
                        }}
                        className="p-1 rounded-full text-zinc-400 hover:bg-zinc-900 hover:text-white transition-colors disabled:opacity-50"
                      >
                        <ActionIcon className="w-3 h-3" />
                      </button>
                    )
                  })}
                </div>
                {/* WhatsApp 24h reply window — green (not amber) to read as WhatsApp's own color, not a warning */}
                {windowStatus && (
                  <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap shrink-0 ${
                      windowStatus.closed ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'
                    }`}
                  >
                    {windowStatus.label}
                  </span>
                )}
                <span className="text-[10px] text-zinc-400 shrink-0">{timeAgoShort(c.last_message_at)}</span>
                {unread && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
              </div>
              <p className={`mt-0.5 text-xs truncate pl-5.5 flex items-center gap-1 ${unread ? 'text-zinc-700' : 'text-zinc-400'}`}>
                {/* Real tool result, not AI prose — the checker actually ran and found/didn't find a private slot. */}
                {c.ota_available === true && <CheckCircle2 className="w-3 h-3 text-green-600 shrink-0" />}
                {c.ota_available === false && <XCircle className="w-3 h-3 text-red-500 shrink-0" />}
                <span className="truncate">
                  {c.snippet_direction === 'out' && '↩ '}
                  {c.ai_summary ?? c.snippet}
                </span>
              </p>
              {statusFilter === 'pending' && (
                <p className="mt-1 ml-5.5 text-[10px] text-zinc-400">
                  {c.last_outbound_at ? `Last reply from us: ${timeAgoShort(c.last_outbound_at)}` : 'We have not replied yet'}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
