import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { TRACKING_EVENTS } from '@/lib/tracking/constants'
import { checkRateLimit } from '@/lib/tracking/rate-limit'
import { isBot } from '@/lib/tracking/bot-filter'

/**
 * POST /api/tracking/event
 *
 * Logs a funnel tracking event. Called via sendBeacon from the client.
 * Always returns 200 — tracking must never break the user experience.
 */
export async function POST(request: NextRequest) {
  // Bot filter
  if (isBot(request.headers.get('user-agent'))) {
    return NextResponse.json({ ok: true })
  }

  // Rate limit: 120 requests per minute per IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkRateLimit(ip, 'event', 120, 60_000)) {
    return NextResponse.json({ ok: true }) // Silent — don't reveal rate limiting to client
  }

  try {
    // sendBeacon sends as text/plain or application/json
    let body: Record<string, unknown>
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      body = await request.json()
    } else {
      const text = await request.text()
      body = JSON.parse(text)
    }

    const { session_id, visitor_id, event_name, metadata } = body as {
      session_id?: string
      visitor_id?: string
      event_name?: string
      metadata?: Record<string, unknown>
    }

    if (!session_id || !visitor_id || !event_name) {
      return NextResponse.json({ ok: true }) // Silent fail
    }

    // Validate event name
    if (!TRACKING_EVENTS.includes(event_name as typeof TRACKING_EVENTS[number])) {
      return NextResponse.json({ ok: true }) // Silent fail on unknown events
    }

    const supabase = createAdminClient()

    await supabase.from('tracking_events').insert({
      session_id,
      visitor_id,
      event_name,
      metadata: (metadata ?? null) as import('@/lib/supabase/types').Json,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[tracking/event] unhandled error:', err)
    return NextResponse.json({ ok: true })
  }
}
