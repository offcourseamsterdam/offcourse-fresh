/**
 * Pure validation for the public chat API — no I/O, fully unit-testable.
 * The public routes are unauthenticated, so these are the front door locks:
 * everything is length-capped and shape-checked before it touches the DB.
 */

export const MAX_NAME_LENGTH = 80
export const MAX_EMAIL_LENGTH = 254
export const MAX_MESSAGE_LENGTH = 2000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface ChatStartPayload {
  name: string
  email: string
  message: string
}

/** Trim + validate the "start a conversation" form. Returns the clean payload or an error string. */
export function parseChatStart(body: unknown): { payload: ChatStartPayload } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'Invalid request body' }
  const { name, email, message } = body as Record<string, unknown>

  if (typeof name !== 'string' || name.trim().length === 0) return { error: 'Name is required' }
  if (name.trim().length > MAX_NAME_LENGTH) return { error: 'Name is too long' }

  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim()) || email.trim().length > MAX_EMAIL_LENGTH) {
    return { error: 'A valid email is required' }
  }

  const msg = parseChatMessage(message)
  if ('error' in msg) return msg

  return {
    payload: {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      message: msg.message,
    },
  }
}

/** Trim + validate one chat message body. */
export function parseChatMessage(message: unknown): { message: string } | { error: string } {
  if (typeof message !== 'string' || message.trim().length === 0) return { error: 'Message is required' }
  if (message.trim().length > MAX_MESSAGE_LENGTH) return { error: 'Message is too long' }
  return { message: message.trim() }
}

/** Webchat tokens are UUIDs — reject anything else before querying. */
export function isValidChatToken(token: unknown): token is string {
  return typeof token === 'string' && UUID_RE.test(token)
}
