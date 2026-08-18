'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, MessageSquare, Search } from 'lucide-react'
import {
  CATEGORY_LABELS,
  SLACK_NOTIFICATION_CATEGORIES,
  SLACK_NOTIFICATION_TYPES,
  type SlackNotificationCategory,
} from '@/lib/slack/notification-types'
import { CategoryBadge, DestinationBadge, KindCode, SeverityBadge } from '../badges'

/**
 * The reference page: every kind of Slack message the site can send, what makes it
 * fire, and what to do about it. Rendered straight from the catalog in
 * lib/slack/notification-types.ts — add a type there and it shows up here.
 */
export default function NotificationTypesPage() {
  const { locale } = useParams<{ locale: string }>()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<SlackNotificationCategory | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return SLACK_NOTIFICATION_TYPES.filter(t => {
      if (category && t.category !== category) return false
      if (!q) return true
      return (
        t.label.toLowerCase().includes(q) ||
        t.kind.toLowerCase().includes(q) ||
        t.trigger.toLowerCase().includes(q) ||
        t.action.toLowerCase().includes(q)
      )
    })
  }, [search, category])

  const grouped = useMemo(() => {
    return SLACK_NOTIFICATION_CATEGORIES.map(c => ({
      category: c,
      types: filtered.filter(t => t.category === c),
    })).filter(g => g.types.length > 0)
  }, [filtered])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-none space-y-5 sm:space-y-6">

      <Link
        href={`/${locale}/admin/notifications`}
        className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 min-h-[44px] sm:min-h-0"
      >
        <ArrowLeft className="w-4 h-4" /> Back to recent notifications
      </Link>

      <div>
        <h1 className="text-xl sm:text-2xl font-semibold text-zinc-900 flex items-center gap-2">
          <MessageSquare className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-500" />
          Notification types
        </h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
          The {SLACK_NOTIFICATION_TYPES.length} kinds of message the site can send to Slack. Each one
          says what sets it off and what you should do when it lands.
        </p>
      </div>

      {/* Search + category filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search notification types…"
            className="w-full rounded-lg border border-zinc-200 bg-white pl-9 pr-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 min-h-[44px]"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setCategory(null)}
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
            category === null
              ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
              : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
          }`}
        >
          All categories
        </button>
        {SLACK_NOTIFICATION_CATEGORIES.map(c => (
          <button
            key={c}
            onClick={() => setCategory(c === category ? null : c)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              category === c
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 font-medium'
                : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'
            }`}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white px-6 py-12 text-center text-sm text-zinc-500">
          No notification type matches “{search}”.
        </div>
      ) : (
        grouped.map(group => (
          <section key={group.category} className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-900 uppercase tracking-wide">
              {CATEGORY_LABELS[group.category]}
              <span className="ml-2 text-xs font-normal text-zinc-400 normal-case tracking-normal">
                {group.types.length} type{group.types.length === 1 ? '' : 's'}
              </span>
            </h2>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group.types.map(t => (
                <article
                  key={t.kind}
                  className="rounded-xl border border-zinc-200 bg-white p-4 flex flex-col gap-3"
                >
                  <div className="space-y-2">
                    <h3 className="text-sm font-medium text-zinc-900">{t.label}</h3>
                    <div className="flex flex-wrap gap-1.5">
                      <SeverityBadge severity={t.severity} />
                      <CategoryBadge category={t.category} />
                      <DestinationBadge destination={t.destination} />
                    </div>
                  </div>

                  <dl className="space-y-2 text-xs">
                    <div>
                      <dt className="font-semibold text-zinc-500 uppercase tracking-wide text-[10px]">
                        Fires when
                      </dt>
                      <dd className="text-zinc-700 mt-0.5">{t.trigger}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-zinc-500 uppercase tracking-wide text-[10px]">
                        What to do
                      </dt>
                      <dd className="text-zinc-700 mt-0.5">{t.action}</dd>
                    </div>
                  </dl>

                  <div className="mt-auto pt-2 border-t border-zinc-100 space-y-1.5">
                    <KindCode kind={t.kind} />
                    <p className="text-[10px] text-zinc-400 font-mono break-all">{t.source}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
