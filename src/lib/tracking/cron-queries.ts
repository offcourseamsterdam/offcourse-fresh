/**
 * Shared query logic for cron email summaries.
 * Aggregates bookings and commissions per partner/channel for a date range.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SummaryData } from '@/emails/PeriodicSummary'

interface NotificationSetting {
  id: string
  channel_id: string | null
  partner_id: string | null
  email_recipients: string[]
}

/**
 * Build summary data for a partner or channel over a date range.
 * Returns the data needed by periodicSummaryHtml().
 */
export async function buildSummaryForRecipient(
  supabase: SupabaseClient,
  setting: NotificationSetting,
  from: Date,
  to: Date,
  periodLabel: string,
  isInvoice = false,
): Promise<SummaryData | null> {
  // Get the name of the recipient
  let recipientName = 'Partner'
  if (setting.partner_id) {
    const { data: partner } = await supabase
      .from('partners')
      .select('name')
      .eq('id', setting.partner_id)
      .single()
    recipientName = partner?.name ?? 'Partner'
  } else if (setting.channel_id) {
    const { data: channel } = await supabase
      .from('channels')
      .select('name')
      .eq('id', setting.channel_id)
      .single()
    recipientName = channel?.name ?? 'Channel'
  }

  // Get campaigns linked to this partner or channel
  let campaignQuery = supabase.from('campaigns').select('id, name, slug, investment_type, percentage_value, investment_amount')
  if (setting.partner_id) {
    campaignQuery = campaignQuery.eq('partner_id', setting.partner_id)
  } else if (setting.channel_id) {
    campaignQuery = campaignQuery.eq('channel_id', setting.channel_id)
  }
  const { data: campaigns } = await campaignQuery

  if (!campaigns?.length) {
    return {
      recipientName,
      periodLabel,
      totalBookings: 0,
      totalRevenueCents: 0,
      totalCommissionCents: 0,
      campaigns: [],
      isInvoice,
    }
  }

  const campaignIds = campaigns.map((c) => c.id)

  // Get bookings linked to these campaigns in the date range
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, campaign_id, stripe_amount, status')
    .in('campaign_id', campaignIds)
    .gte('created_at', from.toISOString())
    .lt('created_at', to.toISOString())
    .eq('status', 'confirmed')

  // Get campaign links for commission calculation
  const { data: links } = await supabase
    .from('campaign_links')
    .select('id, campaign_id, commission_type, commission_percentage, fixed_commission_amount')
    .in('campaign_id', campaignIds)

  // Build per-campaign breakdown
  const campaignBreakdown = campaigns.map((campaign) => {
    const campaignBookings = bookings?.filter((b) => b.campaign_id === campaign.id) ?? []
    const revenueCents = campaignBookings.reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0)

    // Calculate commission from the first matching link
    const link = links?.find((l) => l.campaign_id === campaign.id)
    let commissionCents = 0
    for (const booking of campaignBookings) {
      if (link?.commission_type === 'percentage' && link.commission_percentage) {
        commissionCents += Math.round((booking.stripe_amount ?? 0) * (link.commission_percentage / 100))
      } else if (link?.commission_type === 'fixed_amount' && link.fixed_commission_amount) {
        commissionCents += link.fixed_commission_amount
      }
    }

    // Format the commission rate as a human-readable string
    let commissionRate: string | undefined
    if (campaign.investment_type === 'percentage' && campaign.percentage_value != null) {
      commissionRate = `${campaign.percentage_value}%`
    } else if (campaign.investment_type === 'fixed_amount' && campaign.investment_amount != null) {
      commissionRate = `€${(campaign.investment_amount / 100).toFixed(0)} fixed`
    }

    return {
      name: campaign.name,
      bookings: campaignBookings.length,
      revenueCents,
      commissionCents,
      commissionRate,
    }
  }).filter((c) => c.bookings > 0) // Only include campaigns with bookings

  const totalBookings = campaignBreakdown.reduce((sum, c) => sum + c.bookings, 0)
  const totalRevenueCents = campaignBreakdown.reduce((sum, c) => sum + c.revenueCents, 0)
  const totalCommissionCents = campaignBreakdown.reduce((sum, c) => sum + c.commissionCents, 0)

  return {
    recipientName,
    periodLabel,
    totalBookings,
    totalRevenueCents,
    totalCommissionCents,
    campaigns: campaignBreakdown,
    isInvoice,
  }
}

/**
 * Get notification settings for a specific interval.
 */
export async function getNotificationSettings(
  supabase: SupabaseClient,
  interval: 'notify_weekly' | 'notify_monthly' | 'notify_quarterly',
) {
  const { data } = await supabase
    .from('notification_settings')
    .select('id, channel_id, partner_id, email_recipients')
    .eq(interval, true)

  return (data ?? []) as NotificationSetting[]
}
