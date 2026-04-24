/**
 * Post a plain-text message to the configured Slack webhook.
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
