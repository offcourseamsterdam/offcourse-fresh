/**
 * Lightweight Twilio SMS Client
 *
 * Provides phone number normalization (E.164) and resilient SMS dispatch
 * via the Twilio REST API. Gracefully mocks dispatches when credentials are
 * missing (e.g. local dev / test suites).
 */

export interface SendSmsParams {
  to: string
  body: string
  from?: string
}

export interface SendSmsResult {
  success: boolean
  sid?: string
  mock?: boolean
  error?: string
}

/**
 * Normalizes phone numbers to standard E.164 format.
 * - Dutch domestic mobile (e.g. "0612345678" or "06 12 34 56 78") -> "+31612345678"
 * - International numbers with 00 prefix (e.g. "0031612345678") -> "+31612345678"
 * - Formatted international numbers (e.g. "+1 (555) 234-5678") -> "+15552345678"
 * Returns null if the number cannot be parsed into a valid phone format.
 */
export function normalizePhoneNumber(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null

  // Remove spaces, hyphens, brackets, dots
  let cleaned = raw.trim().replace(/[\s\-\(\)\.]+/g, '')
  if (!cleaned) return null

  // Convert 00 prefix to +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2)
  }

  // Convert Dutch 06 domestic mobile to +316
  if (/^06\d{8}$/.test(cleaned)) {
    cleaned = '+316' + cleaned.slice(2)
  }

  // Convert 11-digit US number starting with 1 (e.g. 12816029365) to +12816029365
  if (/^1\d{10}$/.test(cleaned)) {
    cleaned = '+' + cleaned
  }

  // Convert 10-digit US/Canada local number (e.g. 2816029365) to +12816029365
  if (/^[2-9]\d{9}$/.test(cleaned)) {
    cleaned = '+1' + cleaned
  }

  // Ensure starts with '+' and has between 7 and 15 digits (ITU-T E.164 specification)
  if (!cleaned.startsWith('+')) {
    return null
  }

  const digits = cleaned.slice(1)
  if (!/^\d{7,15}$/.test(digits)) {
    return null
  }

  return cleaned
}

/**
 * Sends an SMS message via Twilio REST API.
 */
export async function sendTwilioSms(params: SendSmsParams): Promise<SendSmsResult> {
  const normalizedTo = normalizePhoneNumber(params.to)
  if (!normalizedTo) {
    return {
      success: false,
      error: `Invalid phone number: ${params.to}. Could not normalize to E.164.`,
    }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN

  // Smart sender selection:
  // - North America (+1): US carriers do not support alphanumeric IDs, require E.164 phone number
  // - Other international (+44, etc.): Alphanumeric sender ID 'Off Course' avoids cross-border carrier error 21612
  // - Dutch (+31): Can use configured TWILIO_FROM_NUMBER or 'Off Course'
  let defaultFrom = process.env.TWILIO_SENDER_ID || 'Off Course'
  if (normalizedTo.startsWith('+1')) {
    defaultFrom = process.env.TWILIO_US_NUMBER || '+17159974693'
  } else if (process.env.TWILIO_FROM_NUMBER && normalizedTo.startsWith('+31')) {
    defaultFrom = process.env.TWILIO_FROM_NUMBER
  }

  const fromNumber = params.from || defaultFrom || process.env.TWILIO_FROM_NUMBER || '+3197006532242'

  // If credentials are not configured, perform safe mock send (useful for local dev/testing)
  if (!accountSid || !authToken) {
    const mockSid = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    console.info(`[Twilio Mock SMS] To: ${normalizedTo} | From: ${fromNumber} | Body: ${params.body.replace(/\n/g, ' ')}`)
    return {
      success: true,
      sid: mockSid,
      mock: true,
    }
  }

  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`
    const bodyParams = new URLSearchParams()
    bodyParams.append('To', normalizedTo)
    bodyParams.append('From', fromNumber)
    bodyParams.append('Body', params.body)

    const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: bodyParams.toString(),
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      return {
        success: false,
        error: data.message || `Twilio HTTP error ${response.status}`,
      }
    }

    return {
      success: true,
      sid: data.sid,
    }
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Unknown network error sending Twilio SMS',
    }
  }
}
