import type { SupabaseClient } from '@supabase/supabase-js'
import { postSlackText, postSlackDM } from '@/lib/slack/send-notification'

/** Beer's Slack user id — affiliate-referred WhatsApp taps go straight to him, not the shared channel. */
const AFFILIATE_ALERT_SLACK_USER_ID = 'U08PRAX8A07'

/** Friendly labels for the WhatsApp click sources (mirrors the admin dashboard). */
const SOURCE_LABELS: Record<string, string> = {
  floating_button: 'Floating button',
  footer: 'Footer link',
  chat_to_book: 'Chat to book',
  pride_booking_panel: 'Pride WhatsApp prompt',
}

interface AdAlertParts {
  source?: string
  page?: string | null
  gclid?: string
  campaign?: string | null
  country?: string | null
}

/** Build the Slack message for a Google Ads visitor who opened WhatsApp. Pure + testable. */
export function buildWhatsAppAdAlert(parts: AdAlertParts): string {
  const lines = [
    '📱 *A Google Ads visitor just opened WhatsApp*',
    "_They clicked one of your Google ads and reached out on WhatsApp — they may not have booked online._",
    '',
    `• Button: ${parts.source ? (SOURCE_LABELS[parts.source] ?? parts.source) : 'unknown'}`,
  ]
  if (parts.page) lines.push(`• Page: ${parts.page}`)
  if (parts.campaign) lines.push(`• Campaign: ${parts.campaign}`)
  if (parts.country) lines.push(`• Country: ${parts.country}`)
  if (parts.gclid) lines.push(`• gclid: ${parts.gclid}`)
  return lines.join('\n')
}

/**
 * If a WhatsApp click came from a Google Ads visitor (the event carries a gclid),
 * post a Slack alert — but only once per session (the visitor may tap several
 * WhatsApp buttons). Best-effort: never throws, so it can't break tracking.
 *
 * Call this BEFORE inserting the new whatsapp_click row, so the "already alerted"
 * check sees only prior taps.
 */
export async function notifyGoogleAdsWhatsAppClick(
  supabase: SupabaseClient,
  sessionId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<void> {
  try {
    const gclid = typeof metadata?.gclid === 'string' && metadata.gclid ? metadata.gclid : undefined
    if (!gclid) return // not a Google Ads visitor → nothing to alert

    // Dedup: only alert on the first WhatsApp tap of the session.
    const { count } = await supabase
      .from('tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('event_name', 'whatsapp_click')
    if ((count ?? 0) > 0) return // already had a tap (and thus already alerted)

    // Enrich the alert with campaign / location context from the session.
    const { data: session } = await supabase
      .from('analytics_sessions')
      .select('utm_campaign, campaign_slug, entry_page, country_code')
      .eq('id', sessionId)
      .maybeSingle()

    const source = typeof metadata?.source === 'string' ? metadata.source : undefined
    const page = typeof metadata?.path === 'string' ? metadata.path : session?.entry_page ?? null

    await postSlackText(
      buildWhatsAppAdAlert({
        source,
        page,
        gclid,
        campaign: session?.utm_campaign ?? session?.campaign_slug ?? null,
        country: session?.country_code ?? null,
      }),
    )
  } catch (err) {
    console.error('[tracking/whatsapp-alert] failed:', err)
  }
}

interface AffiliateAlertParts {
  source?: string
  page?: string | null
  partnerName?: string | null
  campaignSlug?: string | null
}

/** Build the Slack DM for a partner-referred visitor who opened WhatsApp. Pure + testable. */
export function buildAffiliateWhatsAppAlert(parts: AffiliateAlertParts): string {
  const label = parts.partnerName ?? parts.campaignSlug ?? 'unknown affiliate'
  const lines = [
    '🤝 *An affiliate-referred visitor just opened WhatsApp*',
    `_Someone messaged in from the Pride cruise WhatsApp button, referred by *${label}*._`,
    '',
    `• Button: ${parts.source ? (SOURCE_LABELS[parts.source] ?? parts.source) : 'unknown'}`,
  ]
  if (parts.page) lines.push(`• Page: ${parts.page}`)
  if (parts.campaignSlug) lines.push(`• Campaign: ${parts.campaignSlug}`)
  return lines.join('\n')
}

/**
 * If a WhatsApp click carries partner/campaign attribution (the visitor came in
 * via a partner link), DM Beer directly — this is how commission conversations
 * get credited to the right partner. Only once per session, same discipline as
 * the Google Ads alert above. Best-effort: never throws.
 *
 * Call this BEFORE inserting the new whatsapp_click row, so the "already alerted"
 * check sees only prior taps.
 */
export async function notifyAffiliateWhatsAppClick(
  supabase: SupabaseClient,
  sessionId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<void> {
  try {
    const partnerId = typeof metadata?.partner_id === 'string' && metadata.partner_id ? metadata.partner_id : undefined
    const campaignSlug = typeof metadata?.campaign_slug === 'string' && metadata.campaign_slug ? metadata.campaign_slug : undefined
    if (!partnerId && !campaignSlug) return // no affiliate attribution → nothing to alert

    // Dedup: only alert on the first WhatsApp tap of the session.
    const { count } = await supabase
      .from('tracking_events')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .eq('event_name', 'whatsapp_click')
    if ((count ?? 0) > 0) return // already had a tap (and thus already alerted)

    let partnerName: string | null = null
    if (partnerId) {
      const { data: partner } = await supabase
        .from('partners')
        .select('name')
        .eq('id', partnerId)
        .maybeSingle()
      partnerName = partner?.name ?? null
    }

    const source = typeof metadata?.source === 'string' ? metadata.source : undefined
    const page = typeof metadata?.path === 'string' ? metadata.path : null

    // Straight to Beer's DM only — no shared-channel fallback, so partner
    // conversations don't leak into the general alerts channel.
    await postSlackDM(
      buildAffiliateWhatsAppAlert({ source, page, partnerName, campaignSlug }),
      AFFILIATE_ALERT_SLACK_USER_ID,
    )
  } catch (err) {
    console.error('[tracking/whatsapp-alert] affiliate alert failed:', err)
  }
}
