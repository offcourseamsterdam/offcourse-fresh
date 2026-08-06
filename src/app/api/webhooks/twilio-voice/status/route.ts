import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'
import { canonicalWebhookUrl } from '@/lib/twilio/canonical-url'
import { logWebhookEvent } from '@/lib/webhooks/log'

/**
 * POST /api/webhooks/twilio-voice/status?conversationId=...
 *
 * The <Dial>'s `action` callback from twilio-voice/route.ts — fires once the
 * dial to <Client>beer</Client> + the phone number resolves, however it
 * resolves. `completed` = someone answered (update the call log with how
 * long); anything else = no one picked up on either end, so fall back to a
 * voicemail greeting + recording rather than just hanging up on the caller.
 */

function xml(body: string) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}

function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'
  return `${base.replace(/\/$/, '')}${path}`
}

const VOICEMAIL_GREETING =
  "Hey, you've reached Off Course Amsterdam. We're out on the water right now — leave your name and number after the beep and we'll get back to you."

export async function POST(req: NextRequest) {
  const supabase = createAdminClient()
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? ''

  const formData = await req.formData()
  const params: Record<string, string> = {}
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') params[key] = value
  }

  const signature = req.headers.get('x-twilio-signature')
  const signatureValid = verifyTwilioSignature(canonicalWebhookUrl(req), params, signature, authToken)
  if (!signatureValid) {
    await logWebhookEvent(supabase, {
      source: 'twilio_voice_status',
      providerEventId: params.CallSid ?? null,
      signatureValid: false,
      payload: params,
      error: 'Invalid or missing X-Twilio-Signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const conversationId = req.nextUrl.searchParams.get('conversationId')
  const dialStatus = params.DialCallStatus
  const callSid = params.CallSid

  await logWebhookEvent(supabase, {
    source: 'twilio_voice_status',
    providerEventId: callSid ?? null,
    signatureValid: true,
    payload: params,
    processed: true,
  })

  if (!conversationId || !callSid) {
    return xml('<Response><Say>Sorry, something went wrong. Please try again later.</Say></Response>')
  }

  if (dialStatus === 'completed') {
    const durationSec = params.DialCallDuration ?? '0'
    await supabase
      .from('messages')
      .update({ body: `Call answered (${durationSec}s)` })
      .eq('conversation_id', conversationId)
      .eq('provider_message_id', callSid)
    return xml('<Response></Response>')
  }

  // no-answer / busy / failed / canceled — no one picked up either ring
  // target, so this becomes a voicemail instead of a dropped call.
  await supabase
    .from('messages')
    .update({ body: 'Missed call — leaving a voicemail' })
    .eq('conversation_id', conversationId)
    .eq('provider_message_id', callSid)

  const recordingCallback = absoluteUrl(`/api/webhooks/twilio-voice/recording?conversationId=${conversationId}&voicemail=true`)
  return xml(
    `<Response><Say>${VOICEMAIL_GREETING}</Say>` +
      `<Record maxLength="120" playBeep="true" recordingStatusCallback="${recordingCallback}" transcribe="true" transcribeCallback="${recordingCallback}" /></Response>`,
  )
}
