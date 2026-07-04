import type { NotificationDirection, RecipientType } from './catalog'

export interface SlackLogEntry {
  notificationType?: string
  direction: NotificationDirection
  recipientType: RecipientType
  channel?: string
  messagePreview?: string
  triggeredBy?: string
}

/**
 * Fire-and-forget log of every Slack message sent or received.
 * Silently swallows all errors — Slack is a best-effort side channel and the
 * log must never affect the main request path.
 */
export async function logSlackMessage(entry: SlackLogEntry): Promise<void> {
  try {
    const { createAdminClient } = await import('@/lib/supabase/admin')
    await createAdminClient().from('slack_message_log').insert({
      notification_type: entry.notificationType ?? null,
      direction: entry.direction,
      recipient_type: entry.recipientType,
      channel: entry.channel ?? null,
      message_preview: entry.messagePreview?.slice(0, 300) ?? null,
      triggered_by: entry.triggeredBy ?? null,
    })
  } catch {
    // best-effort
  }
}
