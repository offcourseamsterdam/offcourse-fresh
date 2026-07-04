/**
 * Slack bot API helpers using the bot token (SLACK_BOT_TOKEN).
 * Used by: slash command responses, shift reminders.
 * Best-effort — never throws; logs errors and returns null instead.
 */
import { logSlackMessage } from './log'
import type { SlackSendOpts } from './send-notification'

const SLACK_API = 'https://slack.com/api'

/** Call one Slack Web API method. Returns the parsed payload, or null on any failure. */
async function slackCall(
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const token = process.env.SLACK_BOT_TOKEN
  if (!token) return null
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
    if (!json.ok) {
      console.error(`[slack/${method}] error:`, json.error)
      return null
    }
    return json
  } catch (err) {
    console.error(`[slack/${method}] fetch failed:`, err)
    return null
  }
}

/** Post a plain-text message to a public channel (by name or ID). */
export async function postToChannel(channel: string, text: string, opts?: SlackSendOpts): Promise<void> {
  void logSlackMessage({
    notificationType: opts?.type,
    direction: 'outbound',
    recipientType: 'channel',
    channel,
    messagePreview: text,
    triggeredBy: opts?.triggeredBy,
  })
  await slackCall('chat.postMessage', { channel, text })
}

/** Open a DM with a Slack member ID and send a message. */
export async function postDm(slackMemberId: string, text: string, opts?: SlackSendOpts): Promise<void> {
  void logSlackMessage({
    notificationType: opts?.type,
    direction: 'outbound',
    recipientType: 'dm',
    channel: slackMemberId,
    messagePreview: text,
    triggeredBy: opts?.triggeredBy,
  })
  const opened = await slackCall('conversations.open', { users: slackMemberId })
  const channelId = (opened?.channel as { id?: string } | undefined)?.id
  if (!channelId) return
  await slackCall('chat.postMessage', { channel: channelId, text })
}

/** Resolve a Slack member ID to a human display name (or null on any failure). */
export async function getSlackUserName(memberId: string): Promise<string | null> {
  const res = await slackCall('users.info', { user: memberId })
  const user = res?.user as { real_name?: string; profile?: { real_name?: string }; name?: string } | undefined
  return user?.real_name ?? user?.profile?.real_name ?? user?.name ?? null
}
