/**
 * Slack bot API helpers using the bot token (SLACK_BOT_TOKEN).
 * Used by: slash command responses, shift reminders.
 * Best-effort — never throws; logs errors only.
 */

const SLACK_API = 'https://slack.com/api'

async function slackApi(method: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.ok) console.error(`[slack/${method}] error:`, json.error)
  } catch (err) {
    console.error(`[slack/${method}] fetch failed:`, err)
  }
}

/** Post a plain-text message to a public channel (by name or ID). */
export async function postToChannel(channel: string, text: string): Promise<void> {
  await slackApi('chat.postMessage', { channel, text })
}

/** Open a DM with a Slack member ID and send a message. */
export async function postDm(slackMemberId: string, text: string): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return
  try {
    const res = await fetch(`${SLACK_API}/conversations.open`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ users: slackMemberId }),
    })
    const json = await res.json()
    if (!json.ok) { console.error('[slack/conversations.open] error:', json.error); return }
    await slackApi('chat.postMessage', { channel: json.channel.id, text })
  } catch (err) {
    console.error('[slack/postDm] failed:', err)
  }
}
