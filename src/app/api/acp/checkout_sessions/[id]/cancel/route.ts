import { NextRequest, NextResponse } from 'next/server'
import { getSession, updateSession } from '@/lib/acp/session-store'
import { formatSession } from '@/lib/acp/format-session'

// POST /api/acp/checkout_sessions/{id}/cancel
// No FareHarbor hold to release — this site never reserves a slot before
// payment succeeds (same as the regular booking flow), so canceling is just
// a status flip.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ type: 'invalid_request_error', message: 'No such checkout session' }, { status: 404 })

  if (session.status === 'completed') {
    return NextResponse.json({ type: 'invalid_request_error', message: 'A completed session cannot be canceled' }, { status: 405 })
  }
  if (session.status === 'canceled') {
    return NextResponse.json(formatSession(session))
  }

  const updated = await updateSession(id, { status: 'canceled' })
  return NextResponse.json(formatSession(updated!))
}
