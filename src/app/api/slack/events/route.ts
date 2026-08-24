import { NextResponse, after } from 'next/server'
import { verifySlackSignature } from '@/lib/slack/verify-request'
import { getSlackUserName } from '@/lib/slack/bot'
import { fetchImageAsBase64 } from '@/lib/ai/describe-image'
import { draftMaintenanceTask, type MaintenancePhoto } from '@/lib/ghost/maintenance-drafter'
import { draftUpsellBonus } from '@/lib/ghost/upsell-bonus-drafter'

/**
 * Slack Events API endpoint — intake for two shadow agents.
 *
 * 1. Maintenance: people post in the "Maintenance and Ideas" channel (text
 *    and/or photos); handed to the shadow maintenance drafter. Activates
 *    only once SLACK_MAINTENANCE_CHANNEL_ID is set and the bot is in the
 *    channel with message + files read scopes — until then this is dark.
 * 2. Upsell bonus (Beer, 2026-08-24): a captain DMs the bot directly about
 *    an on-the-water upsell; handed to the shadow upsell-bonus drafter,
 *    which drafts a proposal a human confirms in the Payroll tab. Needs the
 *    Slack app's Events Subscriptions to include the `message.im` bot event
 *    (and `im:history` scope) — until that's enabled, DMs never reach here.
 *
 * Slack demands a 200 within 3 seconds, so all the real work (photo fetch,
 * Gemini, Claude) runs in after(); the route acks immediately.
 */

const MAX_PHOTOS = 4

interface SlackFile {
  mimetype?: string
  url_private?: string
  permalink?: string
}

export interface ExtractedMaintenanceEvent {
  eventId: string
  text: string
  userId: string
  files: SlackFile[]
}

/**
 * Decide whether a Slack event is a genuine human maintenance-channel message
 * and pull the fields we need — pure + exported so the intake rules are unit
 * tested (a photo post arrives as subtype 'file_share', which MUST be accepted;
 * edits/joins/deletes/bot echoes must not). Returns null to ignore the event.
 */
export function extractMaintenanceEvent(
  body: Record<string, unknown>,
  channelId: string | undefined,
): ExtractedMaintenanceEvent | null {
  if (!channelId || body.type !== 'event_callback') return null
  const event = (body.event ?? {}) as Record<string, unknown>
  if (event.type !== 'message' || event.channel !== channelId || event.bot_id) return null

  // file_share is the only message subtype that carries photo attachments — the
  // core of this feature. Accept plain messages (no subtype) and file_share;
  // reject everything else (message_changed, message_deleted, channel_join, …).
  const subtype = typeof event.subtype === 'string' ? event.subtype : undefined
  if (subtype && subtype !== 'file_share') return null

  return {
    eventId: String(body.event_id ?? event.ts ?? ''),
    text: String(event.text ?? ''),
    userId: typeof event.user === 'string' ? event.user : '',
    files: (Array.isArray(event.files) ? event.files : []) as SlackFile[],
  }
}

export interface ExtractedDmEvent {
  eventId: string
  text: string
  userId: string
}

/**
 * Decide whether a Slack event is a genuine human DM to the bot — pure +
 * exported so the intake rules are unit tested, same reasoning as
 * extractMaintenanceEvent. `channel_type === 'im'` is what Slack stamps on a
 * direct-message event; a plain message (no subtype) is a real DM, while
 * edits/joins/deletes/bot echoes must not fire the drafter. Returns null to
 * ignore the event.
 */
export function extractDmEvent(body: Record<string, unknown>): ExtractedDmEvent | null {
  if (body.type !== 'event_callback') return null
  const event = (body.event ?? {}) as Record<string, unknown>
  if (event.type !== 'message' || event.channel_type !== 'im' || event.bot_id) return null
  if (typeof event.subtype === 'string') return null // no subtype = a real DM; edits/joins/deletes carry one

  return {
    eventId: String(body.event_id ?? event.ts ?? ''),
    text: String(event.text ?? ''),
    userId: typeof event.user === 'string' ? event.user : '',
  }
}

/** Only fetch files from Slack's own hosts (the bot token rides on this request). */
function isSlackFileUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.slack.com')
  } catch {
    return false
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  // Read the raw body ONCE — the signature is computed over these exact bytes.
  const raw = await req.text()
  const valid = verifySlackSignature(
    raw,
    req.headers.get('x-slack-request-timestamp'),
    req.headers.get('x-slack-signature'),
  )
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ ok: true })
  }

  // One-time URL verification handshake when the events URL is registered.
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: body.challenge })
  }

  // We ack fast and process in after(), so a Slack retry is a duplicate of an
  // event already being handled — skip it before spending any AI. (The unique
  // index on source_slack_event_id is the backstop for the rare non-retry dup.)
  if (req.headers.get('x-slack-retry-num')) return NextResponse.json({ ok: true })

  const evt = extractMaintenanceEvent(body, process.env.SLACK_MAINTENANCE_CHANNEL_ID)
  if (evt) {
    const channelId = process.env.SLACK_MAINTENANCE_CHANNEL_ID
    // Off the hot path so Slack gets its fast 200.
    after(async () => {
      try {
        const reporter = evt.userId ? (await getSlackUserName(evt.userId)) ?? undefined : undefined
        const photos: MaintenancePhoto[] = []
        for (const f of evt.files.slice(0, MAX_PHOTOS)) {
          if (f.mimetype?.startsWith('image/') && f.url_private && isSlackFileUrl(f.url_private)) {
            try {
              const { base64, mimeType } = await fetchImageAsBase64(f.url_private, {
                Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
              })
              photos.push({ base64, mimeType, url: f.permalink ?? f.url_private })
            } catch (err) {
              console.error('[slack/events] photo fetch failed:', err instanceof Error ? err.message : err)
            }
          }
        }
        await draftMaintenanceTask({ slackEventId: evt.eventId, text: evt.text, reporter, channel: channelId, photos })
      } catch (err) {
        console.error('[slack/events] maintenance draft failed:', err instanceof Error ? err.message : err)
      }
    })
  }

  const dm = extractDmEvent(body)
  if (dm) {
    after(async () => {
      try {
        await draftUpsellBonus({ slackEventId: dm.eventId, text: dm.text, slackUserId: dm.userId })
      } catch (err) {
        console.error('[slack/events] upsell bonus draft failed:', err instanceof Error ? err.message : err)
      }
    })
  }

  // Always ack fast — Slack retries on anything but a prompt 200.
  return NextResponse.json({ ok: true })
}
