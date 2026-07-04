import { logSlackMessage } from './log'
import { postToChannel } from './bot'

export interface SlackSendOpts {
  /** Notification catalog ID — used for logging. */
  type?: string
  /** What triggered this send (e.g. 'stripe_webhook', 'cron', 'admin'). */
  triggeredBy?: string
}

/**
 * Beer's Slack DM — the dev-mode target. Overridable via SLACK_DEV_DM_CHANNEL;
 * shares the default with the AI-cost tripwire (src/lib/ai/usage.ts).
 */
const DEV_DM_CHANNEL = () => process.env.SLACK_DEV_DM_CHANNEL ?? process.env.AI_COST_ALERT_SLACK_ID ?? 'D08PRAXD13R'

/**
 * Post a plain-text message to the configured Slack webhook.
 *
 * DEV REDIRECT: on localhost (NODE_ENV=development) the shared team channel is
 * never touched — every message goes to Beer's DM instead, prefixed [dev], via
 * the bot token. Without SLACK_BOT_TOKEN it silently no-ops. This keeps local
 * testing from paging the whole team while Beer still sees everything fire.
 *
 * No-ops silently when SLACK_WEBHOOK_URL is not set (CI).
 * Never throws — Slack is a best-effort side channel.
 * Every send is logged to slack_message_log (best-effort, non-blocking).
 */
export async function postSlackText(text: string, opts?: SlackSendOpts): Promise<void> {
  const isDev = process.env.NODE_ENV === 'development'

  void logSlackMessage({
    notificationType: opts?.type,
    direction: 'outbound',
    recipientType: isDev ? 'dm' : 'webhook',
    channel: isDev ? DEV_DM_CHANNEL() : 'SLACK_WEBHOOK_URL',
    messagePreview: text,
    triggeredBy: opts?.triggeredBy,
  })

  if (isDev) {
    // postToChannel never throws and no-ops without SLACK_BOT_TOKEN.
    await postToChannel(DEV_DM_CHANNEL(), `[dev] ${text}`)
    return
  }

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
