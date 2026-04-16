import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveChannelSlug } from '@/lib/tracking/attribution'
import { checkRateLimit } from '@/lib/tracking/rate-limit'
import { isBot } from '@/lib/tracking/bot-filter'
import { sanitizeUTMParams } from '@/lib/tracking/sanitize'

/**
 * POST /api/tracking/session
 *
 * Creates or updates an analytics session. Called by the tracking script
 * on every page load (init) and on page hide (close).
 *
 * Uses service role client because anonymous visitors need to write sessions.
 */
export async function POST(request: NextRequest) {
  // Bot filter: don't record sessions from crawlers
  const ua = request.headers.get('user-agent') ?? ''
  if (isBot(ua)) {
    return NextResponse.json({ ok: true })
  }

  // Rate limit: 60 requests per minute per IP
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!checkRateLimit(ip, 60, 60_000)) {
    return NextResponse.json({ ok: false }, { status: 429 })
  }

  try {
    // sendBeacon sends as text/plain, regular fetch sends as application/json
    let body: Record<string, unknown>
    const contentType = request.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      body = await request.json()
    } else {
      const text = await request.text()
      body = JSON.parse(text)
    }

    const {
      visitor_id,
      session_id,
      entry_page,
      exit_page,
      referrer,
      page_count,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_term,
      utm_content,
      campaign_slug,
    } = body as Record<string, string | number | undefined>

    if (!session_id || !visitor_id) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    // Sanitize UTM parameters
    const sanitized = sanitizeUTMParams({
      utm_source: utm_source as string | undefined,
      utm_medium: utm_medium as string | undefined,
      utm_campaign: utm_campaign as string | undefined,
      utm_term: utm_term as string | undefined,
      utm_content: utm_content as string | undefined,
    })

    const supabase = createAdminClient()

    // Parse browser info from User-Agent (reuse ua from bot check)
    const deviceType = /mobile|android|iphone|ipad/i.test(ua) ? 'mobile' : 'desktop'
    const browserName = parseBrowserName(ua)

    // Resolve channel from UTM params
    const channelSlug = resolveChannelSlug(
      utm_source as string | undefined,
      utm_medium as string | undefined,
      referrer as string | undefined,
    )

    // Look up channel_id
    let channelId: string | null = null
    if (channelSlug) {
      const { data: channel } = await supabase
        .from('channels')
        .select('id')
        .eq('slug', channelSlug)
        .single()
      channelId = channel?.id ?? null
    }

    // If campaign_slug is provided, try to look up the campaign link's channel
    if (campaign_slug && !channelId) {
      const { data: link } = await supabase
        .from('campaign_links')
        .select('id, campaign_id')
        .eq('slug', campaign_slug as string)
        .single()
      if (link?.campaign_id) {
        const { data: campaign } = await supabase
          .from('campaigns')
          .select('channel_id')
          .eq('id', link.campaign_id)
          .single()
        channelId = campaign?.channel_id ?? channelId
      }
    }

    // Get country from Vercel header
    const countryCode = request.headers.get('x-vercel-ip-country') ?? null

    // Upsert session
    if (exit_page) {
      // Session close — just update exit info
      await supabase
        .from('analytics_sessions')
        .update({
          exit_page: exit_page as string,
          page_count: (page_count as number) ?? undefined,
          ended_at: new Date().toISOString(),
          session_duration: undefined, // computed later if needed
          updated_at: new Date().toISOString(),
        })
        .eq('id', session_id as string)
    } else {
      // Session init — upsert (create if new, update page_count if existing)
      await supabase
        .from('analytics_sessions')
        .upsert(
          {
            id: session_id as string,
            visitor_id: visitor_id as string,
            entry_page: entry_page as string | undefined,
            referrer: referrer as string | undefined,
            page_count: (page_count as number) ?? 1,
            utm_source: sanitized.utm_source,
            utm_medium: sanitized.utm_medium,
            utm_campaign: sanitized.utm_campaign,
            utm_term: sanitized.utm_term,
            utm_content: sanitized.utm_content,
            campaign_slug: campaign_slug as string | undefined,
            channel_id: channelId,
            browser_name: browserName,
            device_type: deviceType,
            user_agent: ua.slice(0, 500),
            country_code: countryCode,
            ip_address: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
            started_at: new Date().toISOString(),
            is_bounce: true, // Will be set to false if more than 1 page viewed
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        )
    }

    return NextResponse.json({ ok: true })
  } catch {
    // Never fail — tracking errors are silent
    return NextResponse.json({ ok: true })
  }
}

function parseBrowserName(ua: string): string {
  if (/edg/i.test(ua)) return 'Edge'
  if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) return 'Chrome'
  if (/firefox|fxios/i.test(ua)) return 'Firefox'
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari'
  if (/opera|opr/i.test(ua)) return 'Opera'
  return 'Other'
}
