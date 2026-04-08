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

export function apiError(message: string, status = 500) {
  return NextResponse.json({ ok: false, error: message }, { status })
}
