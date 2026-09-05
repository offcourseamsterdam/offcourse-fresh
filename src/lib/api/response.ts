import { NextResponse } from 'next/server'

/**
 * Standard API response shape: { ok: boolean, data?: T, error?: string }
 *
 * Usage:
 *   return apiOk({ listings })        → 200 { ok: true, data: { listings } }
 *   return apiError('Not found', 404) → 404 { ok: false, error: 'Not found' }
 */

export function apiOk<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status })
}

/**
 * `extra` adds sibling fields next to `error` for the rare client that needs
 * more than a message to recover — e.g. the invoice approve/pay routes return
 * `suggested_cents` so the UI can pre-fill an amount field instead of making
 * the user retype it. Never used to smuggle data on a success path.
 */
export function apiError(message: string, status = 500, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status })
}
