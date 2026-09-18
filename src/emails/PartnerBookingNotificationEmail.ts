import { escapeHtml } from '@/lib/utils'

export interface PartnerBookingNotificationData {
  partnerName: string
  listingTitle: string
  bookingDate: string
  startTime: string | null
  endTime?: string | null
  guestCount: number
  customerTypeName?: string | null
  baseAmountCents: number
  commissionAmountCents: number
  campaignName?: string | null
  portalUrl?: string | null
}

export function partnerBookingNotificationEmailHtml(data: PartnerBookingNotificationData): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')
  const revenueEur = `€${(data.baseAmountCents / 100).toFixed(2)}`
  const commissionEur = `€${(data.commissionAmountCents / 100).toFixed(2)}`
  const portalLink = data.portalUrl ?? `${site}/partner`

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0e9e0;background-image:url(${site}/textures/bg-sand.png);background-size:400px;background-repeat:repeat;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;color:#f0e9e0;">New booking confirmed via your partner link — ${commissionEur} commission earned&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:32px 16px 48px;">

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <!-- ═══ HEADER: deep indigo + logo ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:36px 32px 0;border-radius:20px 20px 0 0;text-align:center;">
            <a href="https://offcourseamsterdam.com" style="display:inline-block;">
              <img src="${site}/logos/offcourse-vertical.png" alt="Off Course Amsterdam" width="80" style="display:block;margin:0 auto;width:80px;height:auto;" />
            </a>
          </td>
        </tr>

        <!-- ═══ HEADER STRIP ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:20px 32px 36px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08);">
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.4);">Partner Booking ⛵</p>
            <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;">New Booking Confirmed!</h1>
          </td>
        </tr>

        <!-- ═══ BODY: white card ═══ -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:36px 32px 32px;border-radius:0 0 20px 20px;">

            <!-- Greeting -->
            <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#1e1b4b;">Hey ${escapeHtml(data.partnerName)} 👋</p>
            <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.7;">
              A new booking just came in through your partner link! Here are the cruise details:
            </p>

            <!-- Booking details card -->
            <div style="background-color:#f7f4f0;border-radius:12px;padding:20px 24px;margin-bottom:24px;">
              <h2 style="margin:0 0 14px;font-size:16px;font-weight:700;color:#1e1b4b;">${escapeHtml(data.listingTitle)}</h2>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:14px;color:#374151;line-height:1.8;">
                <tr>
                  <td style="width:110px;color:#6b7280;font-weight:500;">Date:</td>
                  <td style="font-weight:600;color:#1e1b4b;">${escapeHtml(data.bookingDate)}</td>
                </tr>
                ${data.startTime ? `
                <tr>
                  <td style="color:#6b7280;font-weight:500;">Time:</td>
                  <td style="font-weight:600;color:#1e1b4b;">${escapeHtml(data.startTime)}${data.endTime ? ` – ${escapeHtml(data.endTime)}` : ''}</td>
                </tr>
                ` : ''}
                ${data.customerTypeName ? `
                <tr>
                  <td style="color:#6b7280;font-weight:500;">Boat / Option:</td>
                  <td style="font-weight:600;color:#1e1b4b;">${escapeHtml(data.customerTypeName)}</td>
                </tr>
                ` : ''}
                <tr>
                  <td style="color:#6b7280;font-weight:500;">Guests:</td>
                  <td style="font-weight:600;color:#1e1b4b;">${data.guestCount} guest${data.guestCount !== 1 ? 's' : ''}</td>
                </tr>
                ${data.campaignName ? `
                <tr>
                  <td style="color:#6b7280;font-weight:500;">Campaign:</td>
                  <td style="font-weight:600;color:#1e1b4b;">${escapeHtml(data.campaignName)}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <!-- Commission stats card -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
              <tr>
                <td bgcolor="#f7f4f0" style="background-color:#f7f4f0;border-radius:10px;padding:16px;text-align:center;width:48%;">
                  <div style="font-size:20px;font-weight:800;color:#1e1b4b;">${revenueEur}</div>
                  <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;">Booking Value</div>
                </td>
                <td style="width:4%;"></td>
                <td bgcolor="#ecfdf5" style="background-color:#ecfdf5;border-radius:10px;padding:16px;text-align:center;width:48%;">
                  <div style="font-size:20px;font-weight:800;color:#059669;">${commissionEur}</div>
                  <div style="font-size:10px;color:#059669;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;">Earned Commission</div>
                </td>
              </tr>
            </table>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr>
                <td align="center">
                  <a href="${portalLink}"
                     style="display:inline-block;background-color:#1e1b4b;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:10px;letter-spacing:0.5px;">
                    View Partner Dashboard &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
              Commission is calculated over the net base boat rental excl. 9% BTW.
            </p>

          </td>
        </tr>

        <!-- ═══ SPACER ═══ -->
        <tr><td style="height:24px;"></td></tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td style="text-align:center;padding:0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;line-height:1.6;">
              This is an automated booking alert from Off Course Amsterdam.
            </p>
            <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
              Off Course Amsterdam &nbsp;·&nbsp;
              <a href="mailto:cruise@offcourseamsterdam.com" style="color:#9ca3af;text-decoration:none;">cruise@offcourseamsterdam.com</a>
            </p>
          </td>
        </tr>

      </table>

    </td></tr>
  </table>

</body>
</html>`
}
