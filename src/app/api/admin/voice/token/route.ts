import twilio from 'twilio'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'

/**
 * GET /api/admin/voice/token
 *
 * Issues a short-lived Twilio Voice Access Token for the admin browser
 * softphone (Twilio.Device). `identity: 'beer'` is hardcoded for v1 — this is
 * a one-person softphone (Beer explicitly scoped ring-through to "just my
 * phone"), not a multi-agent call center; a real identity-per-admin scheme is
 * a v2 concern if/when more staff need to answer calls from the browser.
 *
 * incomingAllow lets this identity receive the <Client>beer</Client> leg
 * from twilio-voice/route.ts's TwiML.
 */
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID
    const apiKeySid = process.env.TWILIO_API_KEY_SID
    const apiKeySecret = process.env.TWILIO_API_KEY_SECRET
    const twimlAppSid = process.env.TWILIO_TWIML_APP_SID
    if (!accountSid || !apiKeySid || !apiKeySecret || !twimlAppSid) {
      return apiError('Voice calling is not configured (missing TWILIO_API_KEY_SID/SECRET or TWILIO_TWIML_APP_SID)', 503)
    }

    const AccessToken = twilio.jwt.AccessToken
    const VoiceGrant = AccessToken.VoiceGrant

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, { identity: 'beer', ttl: 3600 })
    token.addGrant(new VoiceGrant({ outgoingApplicationSid: twimlAppSid, incomingAllow: true }))

    return apiOk({ token: token.toJwt(), identity: 'beer' })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Could not issue a voice token')
  }
}
