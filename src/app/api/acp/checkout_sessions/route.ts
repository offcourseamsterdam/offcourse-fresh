import { NextRequest, NextResponse } from 'next/server'
import { enforceRateLimit } from '@/lib/rate-limit'
import { resolveCheckoutItems } from '@/lib/acp/resolve-checkout-items'
import { createSession } from '@/lib/acp/session-store'
import { formatSession } from '@/lib/acp/format-session'
import type { CheckoutItemInput } from '@/lib/acp/types'
import type { Json } from '@/lib/supabase/types'

// POST /api/acp/checkout_sessions
// Agentic Commerce Protocol — creates a checkout session for one cruise's
// rate(s) on one date/time. Always re-verifies live FareHarbor availability;
// never trusts that an item id minted from an earlier search is still
// bookable. See src/lib/acp/resolve-checkout-items.ts for the pricing rules
// (private charters are a flat boat rate, shared cruises are per-person).
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, 'acp-checkout-create', 30, 60_000)
  if (limited) return limited

  let body: { items?: CheckoutItemInput[]; buyer?: Json }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ type: 'invalid_request_error', message: 'Invalid JSON body' }, { status: 400 })
  }

  const items = Array.isArray(body.items) ? body.items : []
  const result = await resolveCheckoutItems(items)

  if (!result.ok) {
    return NextResponse.json(
      { type: 'invalid_request_error', code: result.messages[0]?.code, message: result.messages[0]?.content },
      { status: 422 }
    )
  }

  const session = await createSession(result.checkout, 'ready_for_payment', [], body.buyer ?? null)
  return NextResponse.json(formatSession(session), { status: 201 })
}
