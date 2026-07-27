/**
 * Post a plain-text message to the configured Slack webhook (the shared channel).
 *
 * No-ops silently when SLACK_WEBHOOK_URL is not set (dev, CI).
 * Never throws — Slack is a best-effort side channel.
 */
export async function postSlackText(text: string): Promise<void> {
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
export async function postSlackDM(text: string, channel = process.env.SLACK_ALERT_DM_CHANNEL || 'D08PRAXD13R'): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return false

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
    if (!body.ok) {
      console.error('[slack] postSlackDM not ok:', body.error)
      return false
    }
    return true
  } catch (err) {
    console.error('[slack] postSlackDM failed:', err)
    return false
  }
}

/**
 * Route a CRITICAL alert to Beer's DM, falling back to the shared channel webhook
 * if the bot token isn't configured — so a critical booking failure is never lost.
 */
export async function postSlackCritical(text: string): Promise<void> {
  const sentToDm = await postSlackDM(text)
  if (!sentToDm) await postSlackText(text)
}
