'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Ghost, X, Loader2, CheckCircle2, HelpCircle, Mail, Zap } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'

interface FeedItem {
  id: string
  kind: string
  bucket: 'needs_approval' | 'taken' | 'skipped' | 'automated'
  summary: string
  occurredAt: string
  href: string
}

interface SummaryData {
  badgeCount: number
  emailsProcessedToday: number
  feed: FeedItem[]
}

const BUCKET_ORDER = ['needs_approval', 'skipped', 'automated', 'taken'] as const

const BUCKET_LABEL: Record<FeedItem['bucket'], string> = {
  needs_approval: 'Needs your approval',
  skipped: "Couldn't confidently act",
  automated: 'Automated (no AI judgment)',
  taken: 'Ghost took action',
}

const BUCKET_ICON: Record<FeedItem['bucket'], ReactNode> = {
  needs_approval: <HelpCircle className="w-3 h-3 text-amber-500" />,
  skipped: <HelpCircle className="w-3 h-3 text-amber-500" />,
  automated: <Zap className="w-3 h-3 text-indigo-500" />,
  taken: <CheckCircle2 className="w-3 h-3 text-emerald-500" />,
}

/**
 * Persistent header trigger + slide-over panel showing what the Ghost (AI)
 * has done, what it couldn't confidently do, what plain automated code did
 * with zero AI judgment, and what needs a human's approval right now.
 *
 * Mounted once in admin/layout.tsx so it's visible on every admin page.
 * Deliberately does not duplicate /admin/ghost's per-kind review UI — every
 * item here is a one-line summary that links out there for the real decision.
 *
 * Styling mirrors GhostActivityPanel.tsx (planning/GhostActivityPanel.tsx):
 * same full-height right-edge slide-over (fixed inset-0 + flex justify-end,
 * click-outside-to-close on the overlay, max-w-md panel with its own
 * scrolling body), same header layout (icon + title, X close button), same
 * loading/empty-state treatment.
 */
export function AiOpsCenter({ locale }: { locale: string }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useAdminFetch<SummaryData>('/api/admin/ops-center/summary', {
    refreshInterval: 30_000,
  })

  const grouped: Record<FeedItem['bucket'], FeedItem[]> = {
    needs_approval: [],
    skipped: [],
    automated: [],
    taken: [],
  }
  for (const item of data?.feed ?? []) grouped[item.bucket].push(item)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="AI Ops Center"
        className="relative flex items-center justify-center w-11 h-11 rounded-lg hover:bg-zinc-100 transition-colors"
      >
        <Ghost className="w-5 h-5 text-zinc-500" />
        {!!data?.badgeCount && (
          <span className="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none">
            {data.badgeCount > 99 ? '99+' : data.badgeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setOpen(false)}>
          <div
            className="relative h-full w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <div className="flex items-center gap-2">
                <Ghost className="w-4 h-4 text-violet-500" />
                <div>
                  <h2 className="text-base font-semibold text-zinc-900">AI Ops Center</h2>
                  {!!data?.emailsProcessedToday && (
                    <p className="text-xs text-zinc-400 flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {data.emailsProcessedToday} email{data.emailsProcessedToday === 1 ? '' : 's'} processed today
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="p-2 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isLoading && !data && (
                <div className="flex items-center gap-2 text-sm text-zinc-400 px-5 py-8">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
              )}

              {!isLoading && !data?.feed.length && (
                <div className="px-5 py-12 text-center text-zinc-400 text-sm">
                  <Ghost className="w-8 h-8 mx-auto mb-2 text-zinc-300" />
                  <p>Nothing in the last 48 hours.</p>
                </div>
              )}

              {BUCKET_ORDER.map(bucket =>
                grouped[bucket].length > 0 ? (
                  <div key={bucket} className="px-5 py-4 border-b border-zinc-50 last:border-0">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-zinc-400 mb-2 flex items-center gap-1.5">
                      {BUCKET_ICON[bucket]}
                      {BUCKET_LABEL[bucket]}
                    </p>
                    <div className="space-y-2">
                      {grouped[bucket].map(item => (
                        <Link
                          key={item.id}
                          href={`/${locale}${item.href}`}
                          onClick={() => setOpen(false)}
                          className="block text-xs text-zinc-700 hover:text-zinc-900 leading-relaxed"
                        >
                          {item.summary}
                        </Link>
                      ))}
                    </div>
                  </div>
                ) : null
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
