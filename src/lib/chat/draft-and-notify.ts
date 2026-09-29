import { draftShadowReply } from './shadow-drafter'
import { notifyInboxItem, GHOST_KIND_HEADLINE } from '@/lib/slack/notify-inbox'

/**
 * Ghost drafts a reply for a fresh inbound customer message, then DMs Beer —
 * for EVERY inbound message on EVERY chat channel (WhatsApp, website chat,
 * voicemail), whether or not Ghost managed to draft anything.
 *
 * The "no draft" case is the reason this exists as one shared function: the
 * WhatsApp webhook used to `return` silently when Ghost came back empty
 * (API hiccup, empty conversation), so a guest could be waiting with no
 * ping at all. Now the worst case is a plain "New message, no draft" nudge.
 *
 * Never throws — it runs inside after(), and Slack is a best-effort side channel.
 */
export async function draftAndNotify(opts: {
  conversationId: string
  messageId: string | null
  /** Guest name or phone number. */
  from: string
  /** Channel label shown under the headline, e.g. 'via WhatsApp'. */
  via: string
}): Promise<void> {
  try {
    const result = await draftShadowReply(opts.conversationId, opts.messageId)
    await notifyInboxItem({
      conversationId: opts.conversationId,
      from: opts.from,
      headline: result ? GHOST_KIND_HEADLINE[result.kind] : 'New message',
      details: [opts.via, result ? null : 'Ghost could not draft a reply — open it and answer manually.'],
      draft: result?.reply,
      action: result && result.kind !== 'reply_draft' ? 'Needs your approval in the admin panel.' : undefined,
    })
  } catch (err) {
    console.error('[chat/draft-and-notify] failed:', err instanceof Error ? err.message : err)
  }
}
