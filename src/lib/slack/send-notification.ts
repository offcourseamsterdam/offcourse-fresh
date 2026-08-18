import { logSlackNotification } from './log-notification'
import type { SlackNotificationKind } from './notification-types'

/**
 * Post a plain-text message to the configured Slack webhook (the shared channel).
 *
 * `kind` identifies WHICH notification this is — it must be one of the types in
 * notification-types.ts (an unknown string is a compile error). It's stored with the
 * message in `slack_notifications` so Admin → Operations → Notifications can group,
 * filter and explain what fired.
 *
 * No-ops silently when SLACK_WEBHOOK_URL is not set (dev, CI) — nothing is sent, so
 * nothing is logged either.
 * Never throws — Slack is a best-effort side channel.
 */
export async function postSlackText(text: string, kind: SlackNotificationKind): Promise<void> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) return

  // The send outcome is settled FIRST, then logged exactly once. Logging inside the
  // try/catch would let a failing log row be caught as if the Slack post had failed,
  // writing a second, wrong "failed" entry for a message that actually went out.
  let error: string | null = null
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) error = `HTTP ${res.status}`
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  if (error) console.error('[slack] postSlackText failed:', error)

  await logSlackNotification({
    kind,
    destination: 'channel',
    text,
    status: error ? 'failed' : 'sent',
    error,
  }).catch(() => { /* logging is best-effort — it must never break the caller */ })
}

/**
 * Send a direct message to a specific Slack channel/DM via the Web API
 * (chat.postMessage). Used to route CRITICAL booking alerts straight to Beer's DM
 * instead of the shared channel. Requires a bot token; no-ops (returns false) when
 * SLACK_BOT_TOKEN isn't set, so the caller can fall back to the channel webhook.
 * Never throws.
 *
 * `channel` overrides the destination (a Slack user ID also works — Slack opens
 * the DM automatically) — defaults to the shared alert DM used by postSlackCritical.
 */
export async function postSlackDM(
  text: string,
  kind: SlackNotificationKind,
  channel = process.env.SLACK_ALERT_DM_CHANNEL || 'D08PRAXD13R',
): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return false

  // Same shape as postSlackText: settle the send, then log once.
  let error: string | null = null
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!body.ok) error = body.error ?? 'unknown'
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  if (error) console.error('[slack] postSlackDM failed:', error)

  await logSlackNotification({
    kind,
    destination: 'dm',
    channel,
    text,
    status: error ? 'failed' : 'sent',
    error,
  }).catch(() => { /* logging is best-effort — it must never break the caller */ })
  return !error
}

/**
 * Route a CRITICAL alert to Beer's DM, falling back to the shared channel webhook
 * if the bot token isn't configured — so a critical booking failure is never lost.
 *
 * Both attempts are logged when the DM is rejected — the dashboard should show the
 * DM failing, not just the fallback quietly succeeding. A successful DM logs once.
 */
export async function postSlackCritical(text: string, kind: SlackNotificationKind): Promise<void> {
  const sentToDm = await postSlackDM(text, kind)
  if (!sentToDm) await postSlackText(text, kind)
}
