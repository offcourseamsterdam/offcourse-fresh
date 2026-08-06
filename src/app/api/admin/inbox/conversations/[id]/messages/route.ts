import { NextRequest } from 'next/server'
import { apiError, apiOk } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { getUserProfile } from '@/lib/auth/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseChatMessage } from '@/lib/chat/validate'
import { sendReply as sendGmailReply } from '@/lib/gmail/client'
import { sendWhatsappMessage, WhatsappWindowClosedError } from '@/lib/whatsapp/client'

/**
 * POST /api/admin/inbox/conversations/{id}/messages
 * Body: { body, direction: 'out' | 'note' }
 *
 * 'out'  → a reply the customer sees in the widget; thread flips to
 *          'pending' (waiting on the customer — §8b of the inbox plan).
 * 'note' → internal margin-scribble, never delivered anywhere.
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
    const parsed = parseChatMessage(json?.body)
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
      const { data: lastInbound } = await supabase
        .from('messages')
        .select('provider_message_id')
        .eq('conversation_id', id)
        .eq('direction', 'in')
        .not('provider_message_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!contact?.email || !conversation.provider_thread_id) {
        gmailSendError = 'Missing recipient email or Gmail thread id'
      } else {
        try {
          gmailSend = await sendGmailReply({
            threadId: conversation.provider_thread_id,
            to: contact.email,
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
