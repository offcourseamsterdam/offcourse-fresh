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
export async function postSlackDM(text: string, channel = process.env.SLACK_ALERT_DM_CHANNEL || 'U08PRAX8A07'): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return false

  // D08PRAXD13R is Beer's user profile conversation ID, which Slack Web API rejects
  // with channel_not_found when called by bot tokens. Map it directly to Beer's User ID U08PRAX8A07.
  const targetChannel = channel === 'D08PRAXD13R' ? 'U08PRAX8A07' : channel

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel: targetChannel, text }),
    })
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!body.ok) {
      // If a D... channel ID failed with channel_not_found, retry directly with Beer's user ID U08PRAX8A07
      if (body.error === 'channel_not_found' && targetChannel !== 'U08PRAX8A07') {
        const retryRes = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ channel: 'U08PRAX8A07', text }),
        })
        const retryBody = (await retryRes.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (retryBody.ok) return true
      }
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

/**
 * Route a routine ops/notification alert to Beer's DM ONLY — per his explicit
 * instruction (2026-08-22): "only my slack", not the shared #bookings channel,
 * not even as a fallback. This is the default for anything that isn't a
 * catering order or a direct-booking notification (see the "Slack Notification
 * Routing" section of CLAUDE.md) and isn't severe enough to warrant
 * postSlackCritical's channel fallback.
 *
 * Deliberately does NOT fall back to postSlackText if the DM fails — that
 * would silently reintroduce #bookings traffic this policy exists to remove.
 * If SLACK_BOT_TOKEN is ever missing/invalid, the alert is lost from Slack
 * (postSlackDM already logs the reason) but never leaks to the shared channel.
 */
export async function postSlackOps(text: string): Promise<void> {
  await postSlackDM(text)
}
