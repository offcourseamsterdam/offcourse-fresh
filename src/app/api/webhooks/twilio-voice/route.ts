import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'
import { canonicalWebhookUrl } from '@/lib/twilio/canonical-url'
import { findOrCreateContactByPhone, findOrCreateConversationByContact } from '@/lib/twilio/inbox-match'
import { logWebhookEvent } from '@/lib/webhooks/log'

/**
 * POST /api/webhooks/twilio-voice
 *
 * "A call comes in" webhook for TWILIO_VOICE_NUMBER. Returns TwiML that rings
 * the admin browser softphone (a <Client>) AND Beer's real phone
 * (TWILIO_MY_PHONE_NUMBER) at the same time — whoever answers first gets the
 * call, matching how a real receptionist desk phone + mobile forward works.
 * No answer on either → the <Dial>'s `action` callback (twilio-voice/status)
 * takes over and plays voicemail.
 *
 * v1 scope, deliberately simple (docs/plans/unified-inbox-and-comms.md §7):
 * the goal is "no missed customer, every call logged," not a call center.
 */

/** Builds an absolute callback URL for Twilio to call later (status/recording) — distinct
 * from canonicalWebhookUrl(), which reconstructs the URL of the CURRENT request for signature
 * verification. */
function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
  return `${base.replace(/\/$/, '')}${path}`
}

function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

/**
 * The "ring Client + phone, record-from-answer, fall through to voicemail on
 * no answer" Dial — the happy path and the catch block's recovered-conversation
 * fallback need the exact same TwiML, so there's one place that defines it.
 */
function dialWithVoicemailFallback(conversationId: string, myPhone: string): string {
  const statusCallback = absoluteUrl(`/api/webhooks/twilio-voice/status?conversationId=${conversationId}`)
  const recordingCallback = absoluteUrl(`/api/webhooks/twilio-voice/recording?conversationId=${conversationId}`)
  return (
    `<Response><Dial timeout="20" record="record-from-answer" recordingStatusCallback="${recordingCallback}" action="${statusCallback}">` +
    `<Client>beer</Client><Number>${myPhone}</Number>` +
    `</Dial></Response>`
  )
}

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? ''
  const myPhone = process.env.TWILIO_MY_PHONE_NUMBER

  const formData = await req.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') params[key] = value
  }

  const signature = req.headers.get('x-twilio-signature')
  const signatureValid = verifyTwilioSignature(canonicalWebhookUrl(req), params, signature, authToken)

  if (!signatureValid) {
    await logWebhookEvent(supabase, {
      source: 'twilio_voice',
      providerEventId: params.CallSid ?? null,
      signatureValid: false,
      payload: params,
      error: 'Invalid or missing X-Twilio-Signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const fromPhone = params.From
  const callSid = params.CallSid
  if (!fromPhone || !callSid) {
    await logWebhookEvent(supabase, {
      source: 'twilio_voice',
      providerEventId: callSid ?? null,
      signatureValid: true,
      payload: params,
      error: 'Missing From or CallSid',
    })
    return NextResponse.json({ error: 'Missing From or CallSid' }, { status: 400 })
  }

  if (!myPhone) {
    // Fail loud, not silent — an unconfigured ring target means every call
    // rings nothing at all, the exact "missed customer" the feature exists to prevent.
    await logWebhookEvent(supabase, {
      source: 'twilio_voice',
      providerEventId: callSid,
      signatureValid: true,
      payload: params,
      error: 'TWILIO_MY_PHONE_NUMBER is not configured',
    })
    return xml('<Response><Say>Sorry, our phone system is not configured yet. Please email us instead.</Say></Response>')
  }

  // Known as soon as findOrCreateConversationByContact resolves, kept in the
  // outer scope so the catch block below can still build a full voicemail
  // fallback (action/record/recordingStatusCallback) for a failure that
  // happens AFTER this point — e.g. the message insert below throwing — not
  // just the bare-bones apology previously used for every failure regardless
  // of how much had already succeeded.
  let conversationId: string | null = null

  try {
    const contactId = await findOrCreateContactByPhone(supabase, fromPhone, params.CallerName ?? '')
    ;({ id: conversationId } = await findOrCreateConversationByContact(supabase, contactId, 'voice'))

    const { error: insertError } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      direction: 'in',
      body: 'Incoming call',
      author_name: params.CallerName || fromPhone,
      provider: 'twilio_voice',
      provider_message_id: callSid,
    })
    // 23505 (duplicate CallSid) is expected on Twilio's own retries of this
    // webhook — the call is already logged, just re-serve the same TwiML.
    if (insertError && insertError.code !== '23505') {
      throw new Error(`Could not log incoming call ${callSid}: ${insertError.message}`)
    }

    await supabase
      .from('conversations')
      .update({ last_message_at: new Date().toISOString(), status: 'open' })
      .eq('id', conversationId)

    await logWebhookEvent(supabase, {
      source: 'twilio_voice',
      providerEventId: callSid,
      signatureValid: true,
      payload: params,
      processed: true,
    })

    return xml(dialWithVoicemailFallback(conversationId, myPhone))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    await logWebhookEvent(supabase, {
      source: 'twilio_voice',
      providerEventId: callSid,
      signatureValid: true,
      payload: params,
      error: message,
    })
    // Still ring through rather than dead-ending the caller on our own DB
    // hiccup. When the conversation was already resolved before the failure
    // (e.g. the message insert itself is what threw), this must still carry
    // the same action/record/recordingStatusCallback the happy path does —
    // otherwise an unanswered call on this path silently skips voicemail
    // entirely, exactly the "missed customer" scenario this feature exists to
    // prevent, and it fails right when something has already gone wrong.
    if (conversationId) return xml(dialWithVoicemailFallback(conversationId, myPhone))
    return xml(`<Response><Dial timeout="20"><Client>beer</Client><Number>${myPhone}</Number></Dial></Response>`)
  }
}
