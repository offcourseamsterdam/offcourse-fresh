import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'
import { canonicalWebhookUrl } from '@/lib/twilio/canonical-url'
import { findOrCreateContactByPhone, findOrCreateConversationByContact } from '@/lib/twilio/inbox-match'
import { escapeXml } from '@/lib/twilio/escape-xml'
import { logWebhookEvent } from '@/lib/webhooks/log'

/** E.164-ish: a leading + and 8-15 digits — matches what Twilio itself accepts as a Number noun. */
const PHONE_PATTERN = /^\+?[1-9]\d{7,14}$/

/**
 * POST /api/webhooks/twilio-voice/outbound
 *
 * The TwiML App's Voice URL — called when the admin browser softphone places
 * an outbound call (Twilio.Device.connect({ params: { To } }), see
 * CallButton.tsx / VoiceProvider.tsx). Twilio POSTs here to ask what to do
 * with the call the browser just initiated; the answer is always the same:
 * dial the number the admin typed in, showing our real number as caller ID
 * (required — you can't dial out displaying an arbitrary number).
 *
 * Distinct from twilio-voice/route.ts (inbound, configured on the phone
 * number itself) — this is configured on the TwiML App instead, which is
 * only ever invoked for Device-initiated outbound calls.
 */

function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? ''
  const callerId = process.env.TWILIO_VOICE_NUMBER

  const formData = await req.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') params[key] = value
  }

  const signature = req.headers.get('x-twilio-signature')
  const signatureValid = verifyTwilioSignature(canonicalWebhookUrl(req), params, signature, authToken)
  if (!signatureValid) {
    await logWebhookEvent(supabase, {
      source: 'twilio_voice_outbound',
      providerEventId: params.CallSid ?? null,
      signatureValid: false,
      payload: params,
      error: 'Invalid or missing X-Twilio-Signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const to = params.To
  const callSid = params.CallSid
  if (!to || !callSid) {
    await logWebhookEvent(supabase, {
      source: 'twilio_voice_outbound',
      providerEventId: callSid ?? null,
      signatureValid: true,
      payload: params,
      error: 'Missing To or CallSid',
    })
    return xml('<Response><Say>Sorry, no number was given to call.</Say></Response>')
  }

  // `to` is client-controlled (the admin softphone forwards whatever was
  // typed into CallButton's input) — Twilio's signature only proves this
  // request came from Twilio, not that the value it's carrying is safe to
  // drop into hand-built TwiML. Reject anything that isn't phone-number-shaped
  // before it ever reaches the XML string below.
  if (!PHONE_PATTERN.test(to)) {
    await logWebhookEvent(supabase, {
      source: 'twilio_voice_outbound',
      providerEventId: callSid,
      signatureValid: true,
      payload: params,
      error: `Rejected non-phone-number To value: ${to}`,
    })
    return xml('<Response><Say>Sorry, that is not a valid phone number.</Say></Response>')
  }

  if (!callerId) {
    await logWebhookEvent(supabase, {
      source: 'twilio_voice_outbound',
      providerEventId: callSid,
      signatureValid: true,
      payload: params,
      error: 'TWILIO_VOICE_NUMBER is not configured',
    })
    return xml('<Response><Say>Sorry, outbound calling is not configured yet.</Say></Response>')
  }

  try {
    const contactId = await findOrCreateContactByPhone(supabase, to, '')
    const { id: conversationId } = await findOrCreateConversationByContact(supabase, contactId, 'voice')

    const { error: insertError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'out',
      body: `Outbound call to ${to}`,
      author_name: 'Off Course',
      provider: 'twilio_voice',
      provider_message_id: callSid,
    })
    // 23505 (duplicate CallSid) would mean Twilio re-requested this same leg's
    // TwiML — the call is already logged, just re-serve the same instructions.
    if (insertError && insertError.code !== '23505') {
      throw new Error(`Could not log outbound call ${callSid}: ${insertError.message}`)
    }

    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId)

    await logWebhookEvent(supabase, {
      source: 'twilio_voice_outbound',
      providerEventId: callSid,
      signatureValid: true,
      payload: params,
      processed: true,
    })
  } catch (err) {
    // Log-and-continue: a DB hiccup shouldn't stop Beer from actually reaching
    // the customer — the call itself matters more than the inbox record of it.
    await logWebhookEvent(supabase, {
      source: 'twilio_voice_outbound',
      providerEventId: callSid,
      signatureValid: true,
      payload: params,
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }

  return xml(`<Response><Dial callerId="${escapeXml(callerId)}"><Number>${escapeXml(to)}</Number></Dial></Response>`)
}
