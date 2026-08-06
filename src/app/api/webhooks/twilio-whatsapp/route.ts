import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'
import { findOrCreateContactByPhone, findOrCreateConversationByContact } from '@/lib/twilio/inbox-match'
import { logWebhookEvent } from '@/lib/webhooks/log'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'

/**
 * POST /api/webhooks/twilio-whatsapp
 *
 * Inbound WhatsApp messages (Twilio). Mirrors the Gmail ingestion pattern
 * (gmail/sync.ts) — find-or-create contact/conversation, insert the message,
 * hand off to the existing, unmodified Ghost pipeline (draftShadowReply). No
 * channel-specific AI logic here.
 *
 * Unlike Gmail (polled by cron, so AI drafting can run inline), this is a
 * live webhook with a ~15s Twilio timeout — draftShadowReply is deferred via
 * after() so the row is saved and a fast 200 returned before the agent runs.
 *
 * WhatsApp has no thread concept like Gmail — one continuous conversation
 * per (contact, channel), matched by contact_id, not a provider thread id.
 */

function canonicalWebhookUrl(): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
  return `${base.replace(/\/$/, '')}/api/webhooks/twilio-whatsapp`
}

/** Twilio expects an XML (TwiML) response body; empty <Response/> = no auto-reply. */
function twimlOk() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? ''

  const formData = await req.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') params[key] = value
  }

  const signature = req.headers.get('x-twilio-signature')
  const signatureValid = verifyTwilioSignature(canonicalWebhookUrl(), params, signature, authToken)

  if (!signatureValid) {
    await logWebhookEvent(supabase, {
      source: 'twilio_whatsapp',
      providerEventId: params.MessageSid ?? null,
      signatureValid: false,
      payload: params,
      error: 'Invalid or missing X-Twilio-Signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const fromRaw = params.From
  const body = params.Body
  const messageSid = params.MessageSid
  if (!fromRaw || !messageSid) {
    await logWebhookEvent(supabase, {
      source: 'twilio_whatsapp',
      providerEventId: messageSid ?? null,
      signatureValid: true,
      payload: params,
      error: 'Missing From or MessageSid',
    })
    return NextResponse.json({ error: 'Missing From or MessageSid' }, { status: 400 })
  }

  const fromPhone = fromRaw.replace(/^whatsapp:/, '')
  const profileName = params.ProfileName ?? ''

  try {
    const contactId = await findOrCreateContactByPhone(supabase, fromPhone, profileName)
    const { id: conversationId, unreadCount } = await findOrCreateConversationByContact(supabase, contactId, 'whatsapp')

    const { data: inserted, error: insertError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        direction: 'in',
        body: body ?? '',
        author_name: profileName || fromPhone,
        provider: 'twilio_whatsapp',
        provider_message_id: messageSid,
      })
      .select('id')
      .single()

    if (insertError) {
      // 23505 = already-ingested MessageSid — Twilio retries on non-2xx, same
      // idempotency gate as the Gmail sync / Stripe webhook.
      if (insertError.code === '23505') {
        await logWebhookEvent(supabase, {
          source: 'twilio_whatsapp',
          providerEventId: messageSid,
          signatureValid: true,
          payload: params,
          processed: true,
          error: 'duplicate (already ingested)',
        })
        return twimlOk()
      }
      throw new Error(`Could not save WhatsApp message ${messageSid}: ${insertError.message}`)
    }

    // Every inbound message reopens the 24h free-form reply window — never
    // extend it on an outbound send, only on what the customer actually sends.
    const windowExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const { error: windowUpdateError } = await supabase
      .from('conversations')
      .update({
        last_message_at: new Date().toISOString(),
        unread_count: unreadCount + 1,
        status: 'open',
        wa_window_expires_at: windowExpiresAt,
      })
      .eq('id', conversationId)
    // The message itself is already saved at this point — but silently
    // returning 200 here would tell Twilio (and us) this webhook fully
    // succeeded when the window-reopen never landed. Throw so it's logged
    // and Twilio gets a non-200, instead of the customer's window quietly
    // staying stale after they just messaged.
    if (windowUpdateError) throw new Error(`Could not reopen WhatsApp window for conversation ${conversationId}: ${windowUpdateError.message}`)

    // Deferred: Ghost's agentic loop can take several seconds — never make
    // Twilio wait on it (15s timeout → retries → duplicate-looking sends).
    after(() => draftShadowReply(conversationId, inserted?.id ?? null))

    await logWebhookEvent(supabase, {
      source: 'twilio_whatsapp',
      providerEventId: messageSid,
      signatureValid: true,
      payload: params,
      processed: true,
    })
    return twimlOk()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await logWebhookEvent(supabase, {
      source: 'twilio_whatsapp',
      providerEventId: messageSid,
      signatureValid: true,
      payload: params,
      error: message,
    })
    // Non-2xx so Twilio retries — a transient DB error shouldn't silently drop the message.
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
