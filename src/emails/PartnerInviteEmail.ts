import { escapeHtml } from '@/lib/utils'

/**
 * Partner portal invite email.
 * Sent when an admin clicks "Send portal invite" on the partners page.
 * The inviteUrl is a Supabase-generated magic link that lets the partner
 * set their password and access the portal.
 */
export function partnerInviteEmailHtml(data: {
  partnerName: string
  inviteUrl: string
}) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0e9e0;background-image:url(${site}/textures/bg-sand.png);background-size:400px;background-repeat:repeat;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Preheader -->
  <div style="display:none;max-height:0;overflow:hidden;color:#f0e9e0;">you're in — access your Off Course partner dashboard here&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

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
            <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.4);">partner portal 🤝</p>
            <h1 style="margin:0;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3;">you&rsquo;re invited</h1>
          </td>
        </tr>

        <!-- ═══ BODY: white card ═══ -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:36px 32px 32px;border-radius:0 0 20px 20px;">

            <!-- Greeting -->
            <p style="margin:0 0 16px;font-size:17px;font-weight:700;color:#1e1b4b;">Hey ${escapeHtml(data.partnerName)} 👋</p>
            <p style="margin:0 0 16px;font-size:15px;color:#374151;line-height:1.7;">
              You&rsquo;ve been added to the Off Course Amsterdam partner program — nice to have you here.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
              Your partner dashboard gives you a live view of clicks, bookings, and commissions across all your campaigns. Set up your account below — the link is valid for 24&nbsp;hours.
            </p>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr>
                <td align="center">
                  <a href="${escapeHtml(data.inviteUrl)}"
                     style="display:inline-block;background-color:#1e1b4b;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.3px;line-height:1;">
                    Access my partner portal &nbsp;&rarr;
                  </a>
                </td>
              </tr>
            </table>

            <!-- Ignore note -->
            <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;">
              Didn&rsquo;t expect this? You can safely ignore it.
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
