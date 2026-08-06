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

/**
 * Send a direct message. Returns whether it actually sent — slackCall swallows
 * the real Slack error (missing SLACK_BOT_TOKEN, revoked auth, unknown user)
 * and logs it, but a caller whose only channel IS this DM (no separate
 * fallback) needs to know it didn't land rather than assume
 * best-effort-and-forget.
 *
 * Accepts EITHER form of id, because Slack's UI hands out both and they are
 * easy to confuse when pasting one into an admin field:
 *   U… (user id)    → open a DM with that person first, then post
 *   D… (DM channel) → already a conversation; post straight to it
 * Passing a D… id to conversations.open fails with `user_not_found`, which
 * previously made the whole DM silently fall back to the shared team channel —
 * the exact opposite of what a DM is for.
 */
export async function postDm(slackMemberId: string, text: string, opts?: SlackSendOpts): Promise<boolean> {
  void logSlackMessage({
    notificationType: opts?.type,
    direction: 'outbound',
    recipientType: 'dm',
    channel: slackMemberId,
    messagePreview: text,
    triggeredBy: opts?.triggeredBy,
  })
  let channelId: string | undefined
  if (slackMemberId.startsWith('D')) {
    channelId = slackMemberId
  } else {
    const opened = await slackCall('conversations.open', { users: slackMemberId })
    channelId = (opened?.channel as { id?: string } | undefined)?.id
  }
  if (!channelId) return false
  const sent = await slackCall('chat.postMessage', { channel: channelId, text })
  return !!sent
}

/** Resolve a Slack member ID to a human display name (or null on any failure). */
export async function getSlackUserName(memberId: string): Promise<string | null> {
  const res = await slackCall('users.info', { user: memberId })
  const user = res?.user as { real_name?: string; profile?: { real_name?: string }; name?: string } | undefined
  return user?.real_name ?? user?.profile?.real_name ?? user?.name ?? null
}
