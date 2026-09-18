import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { partnerBookingNotificationEmailHtml } from '@/emails/PartnerBookingNotificationEmail'
import { formatAmsterdamTime } from '@/lib/utils'

let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY ?? '')
  return _resend
}

export interface SendPartnerBookingNotificationInput {
  partnerId: string
  listingTitle: string
  bookingDate: string
  startTime: string | null
  endTime?: string | null
  guestCount: number
  customerTypeName?: string | null
  baseAmountCents: number
  commissionAmountCents: number
  campaignId?: string | null
  supabase?: ReturnType<typeof createAdminClient>
}

export type SendPartnerBookingNotificationResult =
  | { ok: true; sent: boolean; recipients: string[] }
  | { ok: false; reason: string }

/**
 * Sends a real-time email notification to a partner when a booking is created through their link/campaign.
 * Checks the partner's notification_settings (notify_per_booking) before sending.
 */
export async function sendPartnerBookingNotification(
  input: SendPartnerBookingNotificationInput,
): Promise<SendPartnerBookingNotificationResult> {
  const {
    partnerId,
    listingTitle,
    bookingDate,
    startTime,
    endTime,
    guestCount,
    customerTypeName,
    baseAmountCents,
    commissionAmountCents,
    campaignId,
  } = input

  if (!partnerId) {
    return { ok: false, reason: 'No partnerId provided' }
  }

  const supabase = input.supabase ?? createAdminClient()

  try {
    // 1. Fetch partner info and notification settings in parallel
    const [partnerRes, settingsRes, campaignRes] = await Promise.all([
      supabase
        .from('partners')
        .select('id, name, email, report_token, is_active')
        .eq('id', partnerId)
        .maybeSingle(),
      supabase
        .from('notification_settings')
        .select('notify_per_booking, email_recipients')
        .eq('partner_id', partnerId)
        .maybeSingle(),
      campaignId
        ? supabase.from('campaigns').select('name').eq('id', campaignId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

    const partner = partnerRes.data
    if (!partner || partner.is_active === false) {
      return { ok: false, reason: 'Partner not found or inactive' }
    }

    const settings = settingsRes.data
    // Default to true if not explicitly disabled
    const shouldNotify = settings ? settings.notify_per_booking !== false : true
    if (!shouldNotify) {
      return { ok: true, sent: false, recipients: [] }
    }

    // Determine recipients: custom email_recipients array, or partner's primary email
    const configuredRecipients = settings?.email_recipients ?? []
    const recipients = configuredRecipients.length > 0
      ? configuredRecipients.filter(Boolean)
      : (partner.email ? [partner.email] : [])

    if (recipients.length === 0) {
      return { ok: false, reason: 'No email recipients found for partner' }
    }

    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')
    const portalUrl = partner.report_token
      ? `${siteUrl}/partners/${partner.report_token}`
      : `${siteUrl}/partner`

    const formattedStartTime = startTime ? formatAmsterdamTime(startTime) : null
    const formattedEndTime = endTime ? formatAmsterdamTime(endTime) : null

    const html = partnerBookingNotificationEmailHtml({
      partnerName: partner.name,
      listingTitle,
      bookingDate,
      startTime: formattedStartTime,
      endTime: formattedEndTime,
      guestCount,
      customerTypeName,
      baseAmountCents,
      commissionAmountCents,
      campaignName: campaignRes.data?.name ?? null,
      portalUrl,
    })

    const commissionEur = `€${(commissionAmountCents / 100).toFixed(2)}`
    const resend = getResend()

    const { error: resendError } = await resend.emails.send({
      from: 'Off Course Amsterdam <bookings@offcourseamsterdam.com>',
      to: recipients,
      subject: `New Booking Confirmed: ${listingTitle} — ${commissionEur} commission earned!`,
      html,
    })

    if (resendError) {
      console.error('[sendPartnerBookingNotification] Resend error:', resendError)
      return { ok: false, reason: resendError.message }
    }

    return { ok: true, sent: true, recipients }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[sendPartnerBookingNotification] Unexpected error:', err)
    return { ok: false, reason: msg }
  }
}
