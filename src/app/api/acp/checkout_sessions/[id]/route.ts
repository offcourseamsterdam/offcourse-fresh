import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { resolveCheckoutItems } from '@/lib/acp/resolve-checkout-items'
import { getSession, updateSession } from '@/lib/acp/session-store'
import { formatSession } from '@/lib/acp/format-session'
import type { CheckoutItemInput } from '@/lib/acp/types'

const TERMINAL_STATUSES = new Set(['completed', 'canceled'])

// GET /api/acp/checkout_sessions/{id} — retrieve current state.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ type: 'invalid_request_error', message: 'No such checkout session' }, { status: 404 })
  return NextResponse.json(formatSession(session))
}

// POST /api/acp/checkout_sessions/{id} — update line items (e.g. change quantity).
// A session can only be updated for the SAME cruise/date/time it was created
// with; switching to a different one means creating a new session.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = enforceRateLimit(request, 'acp-checkout-update', 60, 60_000)
  if (limited) return limited

  const { id } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ type: 'invalid_request_error', message: 'No such checkout session' }, { status: 404 })
  if (TERMINAL_STATUSES.has(session.status)) {
    return NextResponse.json({ type: 'invalid_request_error', message: `Session is already ${session.status}` }, { status: 409 })
  }

  let body: { items?: CheckoutItemInput[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ type: 'invalid_request_error', message: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.items)) {
    return NextResponse.json(formatSession(session))
  }

  const result = await resolveCheckoutItems(body.items)
  if (!result.ok) {
    return NextResponse.json(
      { type: 'invalid_request_error', code: result.messages[0]?.code, message: result.messages[0]?.content },
      { status: 422 }
    )
  }

  if (result.checkout.slug !== session.slug || result.checkout.date !== session.date || result.checkout.availPk !== session.avail_pk) {
    return NextResponse.json(
      { type: 'invalid_request_error', message: 'Cannot change cruise, date, or time on an existing session — create a new one' },
      { status: 422 }
    )
  }

  const updated = await updateSession(id, {
    line_items: result.checkout.lineItems,
    total_cents: result.checkout.totalCents,
    status: 'ready_for_payment',
  })
  return NextResponse.json(formatSession(updated!))
}
