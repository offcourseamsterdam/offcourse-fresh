import { postSlackDM } from './send-notification'

/**
 * DMs Beer the moment something lands in the inbox that needs a human — a real
 * customer message (with the Ghost's drafted reply) or a 3rd-party booking
 * notification that isn't in our database yet.
 *
 * Deliberately postSlackDM, never postSlackText: per CLAUDE.md's Slack routing
 * policy, everything except catering and direct-booking notifications goes to
 * Beer's DM rather than the shared #bookings channel. This is not a booking
 * confirmation — it's a "you need to look at this" nudge.
 *
 * Two reasons this exists (both real, 2026-08-21):
 *  - Beer shouldn't have to open the admin panel to find out a guest is
 *    waiting; the draft comes to him with a link straight to the thread.
 *  - Two Boat Local bookings (James Hagler, Victoria Kingdom) sat unimported
 *    for days because nothing announced them — a booking that exists in
 *    FareHarbor but not in our own DB is invisible to Bookings, Planning,
 *    Scheduling and Finance until someone clicks Import.
 *
 * Best-effort: never throws, never blocks ingestion (postSlackDM already
 * swallows its own errors and no-ops without SLACK_BOT_TOKEN).
 */
export interface InboxSlackNotification {
  conversationId: string
  /** Who it's from — guest name for a customer, platform name for an OTA notification. */
  from: string
  /** Short headline of what this is, e.g. 'New message' / 'Booking needs importing'. */
  headline: string
  /** The Ghost's drafted reply, when it wrote one. */
  draft?: string | null
  /** Fact lines rendered under the headline (date, guests, booking ref…). */
  details?: (string | null | undefined)[]
  /** Nudge shown under the draft, e.g. what one click would do. */
  action?: string
}

/** Slack messages get unreadable past a few lines — keep the draft to a glance. */
function truncate(text: string, max = 600): string {
  const clean = text.trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export function conversationUrl(conversationId: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
  return `${base}/en/admin/inbox?c=${conversationId}`
}

export function buildInboxSlackText(n: InboxSlackNotification): string {
  const lines = [`*${n.headline}* — ${n.from}`]
  for (const d of n.details ?? []) if (d) lines.push(d)
  if (n.draft) lines.push('', '> ' + truncate(n.draft).split('\n').join('\n> '))
  if (n.action) lines.push('', `_${n.action}_`)
  lines.push('', `<${conversationUrl(n.conversationId)}|Open in admin →>`)
  return lines.join('\n')
}

export async function notifyInboxItem(n: InboxSlackNotification): Promise<void> {
  try {
    await postSlackDM(buildInboxSlackText(n))
  } catch (err) {
    console.error('[slack/notify-inbox] failed:', err instanceof Error ? err.message : err)
  }
}
