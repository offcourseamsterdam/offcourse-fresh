import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getUserProfile } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseChatMessage } from '@/lib/chat/validate'
import { getAttachmentData, getMessage, sendNewEmail, sendReply as sendGmailReply } from '@/lib/gmail/client'
import { buildForwardBody, forwardSubject, parseForwardTo } from '@/lib/inbox/forward'
import { sendWhatsappMessage, WhatsappWindowClosedError } from '@/lib/whatsapp/client'

/**
 * POST /api/admin/inbox/conversations/{id}/messages
 * Body: { body, direction: 'out' | 'note', forwardTo? }
 *
 * 'out'  → a reply the customer sees in the widget; thread flips to
 *          'pending' (waiting on the customer — §8b of the inbox plan).
 * 'note' → internal margin-scribble, never delivered anywhere.
 * forwardTo (email threads only) → forwards the latest inbound email, with
 *          its attachments, to that address as a NEW email. `body` is an
 *          optional note on top. Logged in the thread as an internal note —
 *          the customer's thread, status and Ghost learning stay untouched.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const json = await req.json().catch(() => null)

    const direction = json?.direction
    if (direction !== 'out' && direction !== 'note') {
      return apiError("direction must be 'out' or 'note'", 400)
    }
    const isForward = json?.forwardTo !== undefined && json?.forwardTo !== null
    const forwardTo = isForward ? parseForwardTo(json.forwardTo) : null
    if (isForward && !forwardTo) return apiError('Enter a valid email address to forward to', 400)
    // A forward's note is optional — the forwarded email itself is the content.
    const hasNote = typeof json?.body === 'string' && json.body.trim().length > 0
    const parsed = forwardTo && !hasNote ? { message: '' } : parseChatMessage(json?.body)
    if ('error' in parsed) return apiError(parsed.error, 400)

    const supabase = createAdminClient()
    const { data: conversation } = await supabase
      .from('conversations')
      .select('id, status, channel, provider_thread_id, subject, contact_id')
      .eq('id', id)
      .maybeSingle()
    if (!conversation) return apiError('Conversation not found', 404)

    const profile = await getUserProfile()
    const authorName = profile?.display_name || 'Off Course'

    if (forwardTo) {
      if (conversation.channel !== 'email') return apiError('Only email threads can be forwarded', 400)
      return forwardEmail({ supabase, conversation, forwardTo, note: parsed.message || null, authorName })
    }

    // Email/WhatsApp replies must actually go out through the provider —
    // unlike webchat, where "stored" IS "delivered" because the widget polls
    // the row. A reply that silently doesn't send would look identical to one
    // that did, which is the worst failure mode for a support inbox.
    let gmailSend: { id: string } | null = null
    let gmailSendError: string | null = null
    if (direction === 'out' && conversation.channel === 'email') {
      const { data: contact } = await supabase
        .from('contacts')
        .select('email')
        .eq('id', conversation.contact_id)
        .maybeSingle()
      const targetEmail = contact?.email
      const { data: lastInbound } = await supabase
        .from('messages')
        .select('provider_message_id')
        .eq('conversation_id', id)
        .eq('direction', 'in')
        .not('provider_message_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!targetEmail || !conversation.provider_thread_id) {
        gmailSendError = 'Missing recipient email or Gmail thread id'
      } else {
        try {
          gmailSend = await sendGmailReply({
            threadId: conversation.provider_thread_id,
            to: targetEmail,
            subject: conversation.subject ?? '',
            body: parsed.message,
            inReplyToMessageId: lastInbound?.provider_message_id ?? null,
          })
        } catch (err) {
          gmailSendError = err instanceof Error ? err.message : 'Gmail send failed'
        }
      }
    }

    let whatsappSend: { id: string } | null = null
    let whatsappSendError: string | null = null
    if (direction === 'out' && conversation.channel === 'whatsapp') {
      const { data: contact } = await supabase
        .from('contacts')
        .select('phone_e164')
        .eq('id', conversation.contact_id)
        .maybeSingle()

      if (!contact?.phone_e164) {
        whatsappSendError = 'Missing recipient phone number'
      } else {
        try {
          whatsappSend = await sendWhatsappMessage({ to: contact.phone_e164, body: parsed.message })
        } catch (err) {
          // The 24h-window closure is an expected, explainable state (not a
          // bug) — surfaced with guidance instead of a bare Twilio error code.
          whatsappSendError = err instanceof WhatsappWindowClosedError ? err.message : err instanceof Error ? err.message : 'WhatsApp send failed'
        }
      }
    }

    const sendError = gmailSendError ?? whatsappSendError
    const { data: message, error } = await supabase
      .from('messages')
      .insert({
        conversation_id: id,
        direction,
        body: parsed.message,
        author_name: authorName,
        ...(gmailSend ? { provider: 'gmail', provider_message_id: gmailSend.id } : {}),
        ...(whatsappSend ? { provider: 'twilio_whatsapp', provider_message_id: whatsappSend.id } : {}),
        // Webchat replies are "delivered" the moment they're stored — the
        // widget polls them. Email/WhatsApp get real send-status tracking.
        status: sendError ? 'failed' : direction === 'out' ? 'sent' : 'received',
        error: sendError,
      })
      .select('id, direction, body, author_name, status, error, created_at')
      .single()
    if (error || !message) return apiError(error?.message ?? 'Could not save message', 500)
    if (gmailSendError) return apiError(`Could not send the email: ${gmailSendError}`, 502)
    if (whatsappSendError) return apiError(`Could not send the WhatsApp message: ${whatsappSendError}`, 502)

    if (direction === 'out') {
      await supabase
        .from('conversations')
        .update({
          last_message_at: new Date().toISOString(),
          // Replied → ball is in the customer's court.
          status: conversation.status === 'resolved' ? 'resolved' : 'pending',
        })
        .eq('id', id)

      // The Ghost's learning signal: attach the human's ACTUAL reply to the
      // latest unanswered shadow draft in this conversation. Future drafts
      // include these draft-vs-actual pairs as corrections.
      const { data: openDraft } = await supabase
        .from('agent_proposals')
        .select('id')
        .in('kind', ['reply_draft', 'booking_proposal'])
        .eq('conversation_id', id)
        .is('outcome', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (openDraft) {
        await supabase
          .from('agent_proposals')
          .update({
            outcome: { human_reply: parsed.message, replied_by: authorName, replied_at: new Date().toISOString() },
          })
          .eq('id', openDraft.id)
      }
    }

    return apiOk({ message })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Failed to send message')
  }
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Forwards the latest inbound email (text + attachments) as a fresh email.
 * Fails closed: if the original or any attachment can't be fetched, nothing
 * is sent — a forward to finance@ that silently drops the invoice PDF would
 * look like it worked while losing the one thing that mattered.
 */
async function forwardEmail({ supabase, conversation, forwardTo, note, authorName }: {
  supabase: AdminClient
  conversation: { id: string; subject: string | null; contact_id: string | null }
  forwardTo: string
  note: string | null
  authorName: string
}) {
  const { data: lastInbound } = await supabase
    .from('messages')
    .select('provider_message_id, body, created_at')
    .eq('conversation_id', conversation.id)
    .eq('direction', 'in')
    .not('provider_message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!lastInbound?.provider_message_id) return apiError('No received email in this thread to forward', 400)

  const { data: contact } = conversation.contact_id
    ? await supabase.from('contacts').select('name, email').eq('id', conversation.contact_id).maybeSingle()
    : { data: null }

  let sent: { id: string }
  try {
    const original = await getMessage(lastInbound.provider_message_id)
    const attachments = await Promise.all(
      original.attachments.map(async a => ({
        filename: a.filename,
        mimeType: a.mimeType,
        content: await getAttachmentData(original.id, a.attachmentId),
      })),
    )
    sent = await sendNewEmail({
      to: forwardTo,
      subject: forwardSubject(original.subject || conversation.subject),
      body: buildForwardBody({
        note,
        fromName: contact?.name ?? null,
        fromEmail: contact?.email ?? null,
        sentAt: lastInbound.created_at,
        subject: original.subject || conversation.subject,
        originalBody: original.bodyText || lastInbound.body,
      }),
      attachments,
    })
  } catch (err) {
    return apiError(`Could not forward the email: ${err instanceof Error ? err.message : 'Gmail send failed'}`, 502)
  }

  // Logged as an internal note so the team sees it happened — not as an
  // 'out' reply, which would show as sent to the customer and flip the
  // thread to "waiting on customer".
  const { data: message, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      direction: 'note',
      body: `↪ Doorgestuurd naar ${forwardTo}${note ? `\n\n${note}` : ''}`,
      author_name: authorName,
      status: 'received',
    })
    .select('id, direction, body, author_name, status, error, created_at')
    .single()
  if (error || !message) return apiError(error?.message ?? 'Forwarded, but could not log it in the thread', 500)
  return apiOk({ message, forwardedMessageId: sent.id })
}
