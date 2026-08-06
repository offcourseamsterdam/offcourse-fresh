import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyTwilioSignature } from '@/lib/twilio/verify-signature'
import { canonicalWebhookUrl } from '@/lib/twilio/canonical-url'
import { logWebhookEvent } from '@/lib/webhooks/log'
import { draftShadowReply } from '@/lib/chat/shadow-drafter'

/**
 * POST /api/webhooks/twilio-voice/recording?conversationId=...[&voicemail=true]
 *
 * Twilio calls this URL for TWO distinct events, distinguished by which
 * params are present (both wired to the same URL — see twilio-voice/status):
 *  - `recordingStatusCallback`: recording is ready → save `recording_url`.
 *  - `transcribeCallback` (voicemail only): transcript is ready → replace the
 *    placeholder message body with the actual transcript, then let Ghost
 *    read it like any other inbound message (the plan's "optional Claude
 *    pass turns transcript into a 2-line summary + intent").
 * Always returns empty TwiML; Twilio doesn't use the response body here.
 */

function xml() {
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
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
  const signatureValid = verifyTwilioSignature(canonicalWebhookUrl(req), params, signature, authToken)
  if (!signatureValid) {
    await logWebhookEvent(supabase, {
      source: 'twilio_voice_recording',
      providerEventId: params.CallSid ?? null,
      signatureValid: false,
      payload: params,
      error: 'Invalid or missing X-Twilio-Signature',
    })
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const conversationId = req.nextUrl.searchParams.get('conversationId')
  const callSid = params.CallSid
  await logWebhookEvent(supabase, {
    source: 'twilio_voice_recording',
    providerEventId: callSid ?? null,
    signatureValid: true,
    payload: params,
    processed: true,
  })
  if (!conversationId || !callSid) return xml()

  // Transcription callback — only ever fires for the voicemail flow.
  if (params.TranscriptionStatus) {
    if (params.TranscriptionStatus === 'completed' && params.TranscriptionText) {
      const { data: message } = await supabase
        .from('messages')
        .update({ body: `Voicemail: "${params.TranscriptionText}"` })
        .eq('conversation_id', conversationId)
        .eq('provider_message_id', callSid)
        .select('id')
        .maybeSingle()

      // Same deferred pattern as the other webhooks — Ghost's agentic loop
      // can take several seconds, this callback has its own Twilio timeout.
      if (message) after(() => draftShadowReply(conversationId, message.id))
    } else {
      await supabase
        .from('messages')
        .update({ body: 'Voicemail left (transcription unavailable)' })
        .eq('conversation_id', conversationId)
        .eq('provider_message_id', callSid)
    }
    return xml()
  }

  // Recording-ready callback (answered call or voicemail, whichever this URL was wired to).
  if (params.RecordingUrl) {
    await supabase
      .from('messages')
      .update({ recording_url: params.RecordingUrl })
      .eq('conversation_id', conversationId)
      .eq('provider_message_id', callSid)
  }
  return xml()
}
