import { logSlackMessage } from './log'

export interface SlackSendOpts {
  /** Notification catalog ID — used for logging. */
  type?: string
  /** What triggered this send (e.g. 'stripe_webhook', 'cron', 'admin'). */
  triggeredBy?: string
}

/**
 * Post a plain-text message to the configured Slack webhook.
 *
 * No-ops silently when SLACK_WEBHOOK_URL is not set (dev, CI).
 * Never throws — Slack is a best-effort side channel.
 * Every send is logged to slack_message_log (best-effort, non-blocking).
 */
export async function postSlackText(text: string, opts?: SlackSendOpts): Promise<void> {
  void logSlackMessage({
    notificationType: opts?.type,
    direction: 'outbound',
    recipientType: 'webhook',
    channel: 'SLACK_WEBHOOK_URL',
    messagePreview: text,
    triggeredBy: opts?.triggeredBy,
  })

  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.error('[slack] postSlackText failed:', err)
  }
}
