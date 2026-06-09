import { escapeHtml } from '@/lib/utils'

export function paymentLinkEmailHtml(data: {
  customerName: string
  listingTitle: string
  bookingDate: string
  startTime: string
  guestCount: number
  amountCents: number
  paymentUrl: string
}) {
  const firstName = escapeHtml(data.customerName.split(' ')[0])
  const amount = `€${(data.amountCents / 100).toFixed(2)}`
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

  const DL = 'color:#71717a;padding:5px 12px 5px 0;white-space:nowrap;vertical-align:top;font-size:14px;'
  const DV = 'color:#1e1b4b;font-weight:500;text-align:right;padding:5px 0;vertical-align:top;font-size:14px;'

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0e9e0;background-image:url(${site}/textures/bg-sand.png);background-size:400px;background-repeat:repeat;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;color:#f0e9e0;">your spot is almost locked in — just one step left&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

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

        <!-- ═══ CRUISE STRIP: still indigo ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:20px 32px 36px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08);">
            <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.4);">your spot is waiting 🛥️</p>
            <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;">${escapeHtml(data.listingTitle)}</h1>
            <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.6);">
              📅&nbsp;${escapeHtml(data.bookingDate)}
              ${data.startTime ? `&nbsp;&nbsp;🕐&nbsp;${escapeHtml(data.startTime)}` : ''}
              &nbsp;&nbsp;👥&nbsp;${data.guestCount}&nbsp;guest${data.guestCount === 1 ? '' : 's'}
            </p>
          </td>
        </tr>

        <!-- ═══ BODY: white card ═══ -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:36px 32px 32px;border-radius:0 0 20px 20px;">

            <!-- Greeting -->
            <p style="margin:0 0 8px;font-size:17px;font-weight:700;color:#1e1b4b;">Hey ${firstName} 👋</p>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
              Your booking is ready — pay below and your spot on the water is locked in.
            </p>

            <!-- Amount block -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
              <tr>
                <td bgcolor="#f7f4f0" style="background-color:#f7f4f0;border-radius:12px;padding:20px;">
                  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="${DL}">Cruise</td>
                      <td style="color:#1e1b4b;font-weight:600;text-align:right;padding:5px 0;vertical-align:top;font-size:14px;">${escapeHtml(data.listingTitle)}</td>
                    </tr>
                    <tr>
                      <td style="${DL}">Date</td>
                      <td style="${DV}">${escapeHtml(data.bookingDate)}</td>
                    </tr>
                    ${data.startTime ? `<tr>
                      <td style="${DL}">Time</td>
                      <td style="${DV}">${escapeHtml(data.startTime)}</td>
                    </tr>` : ''}
                    <tr>
                      <td style="${DL}">Guests</td>
                      <td style="${DV}">${data.guestCount}</td>
                    </tr>
                    <tr>
                      <td style="color:#71717a;padding:12px 12px 0 0;white-space:nowrap;vertical-align:top;font-size:14px;border-top:1px solid #e8e3dc;">Total</td>
                      <td style="font-size:18px;font-weight:700;color:#1e1b4b;text-align:right;padding:12px 0 0;vertical-align:top;border-top:1px solid #e8e3dc;">${amount}</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;">
              <tr>
                <td align="center">
                  <a href="${escapeHtml(data.paymentUrl)}"
                     style="display:inline-block;background-color:#1e1b4b;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.3px;line-height:1;">
                    Pay now &nbsp;&rarr;
                  </a>
                </td>
              </tr>
            </table>

            <!-- Expiry note -->
            <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;">
              ⏳ This link expires in 24 hours — after that your reservation is automatically released
            </p>

          </td>
        </tr>

        <!-- ═══ SPACER ═══ -->
        <tr><td style="height:24px;"></td></tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td style="text-align:center;padding:0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;line-height:1.6;">Off Course Amsterdam &mdash; your friend with a boat</p>
            <p style="margin:0;font-size:11px;color:#9ca3af;line-height:1.6;">
              Herenmarkt 93A, Amsterdam &nbsp;·&nbsp;
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
