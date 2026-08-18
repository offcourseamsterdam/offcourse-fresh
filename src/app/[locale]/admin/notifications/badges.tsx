'use client'

import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  type SlackNotificationCategory,
  type SlackNotificationDestination,
  type SlackNotificationSeverity,
} from '@/lib/slack/notification-types'

/**
 * The colour language shared by the notification feed and the type catalog, so a
 * "critical" chip means the same thing (and looks the same) on both pages.
 */
const SEVERITY_STYLES: Record<SlackNotificationSeverity, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  info: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
}

const CATEGORY_STYLES: Record<SlackNotificationCategory, string> = {
  bookings: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  payments: 'bg-violet-50 text-violet-700 border-violet-200',
  catering: 'bg-amber-50 text-amber-700 border-amber-200',
  operations: 'bg-sky-50 text-sky-700 border-sky-200',
  marketing: 'bg-lime-50 text-lime-700 border-lime-200',
  system: 'bg-zinc-100 text-zinc-600 border-zinc-200',
}

const DESTINATION_LABELS: Record<SlackNotificationDestination, string> = {
  channel: 'Shared channel',
  dm: 'Beer’s DM',
  'dm-or-channel': 'DM → channel fallback',
}

const chip = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap'

export function SeverityBadge({ severity }: { severity: SlackNotificationSeverity }) {
  return <span className={`${chip} ${SEVERITY_STYLES[severity]}`}>{SEVERITY_LABELS[severity]}</span>
}

export function CategoryBadge({ category }: { category: SlackNotificationCategory }) {
  return <span className={`${chip} ${CATEGORY_STYLES[category]}`}>{CATEGORY_LABELS[category]}</span>
}

export function DestinationBadge({ destination }: { destination: SlackNotificationDestination }) {
  return (
    <span className={`${chip} bg-white text-zinc-500 border-zinc-200`}>{DESTINATION_LABELS[destination]}</span>
  )
}

/** Kind shown as code — the machine id you'd grep for in the codebase. */
export function KindCode({ kind }: { kind: string }) {
  return (
    <code className="text-[11px] font-mono text-zinc-500 bg-zinc-100 rounded px-1.5 py-0.5 break-all">
      {kind}
    </code>
  )
}
