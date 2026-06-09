import { escapeHtml } from '@/lib/utils'

/**
 * Periodic summary email (weekly/monthly/quarterly).
 * Reused for all intervals with different headings.
 */
export interface SummaryData {
  recipientName: string
  periodLabel: string        // e.g. "Week of Apr 7–13, 2026" or "March 2026" or "Q1 2026"
  totalBookings: number
  totalRevenueCents: number
  totalCommissionCents: number
  campaigns: {
    name: string
    bookings: number
    revenueCents: number
    commissionCents: number
    /** e.g. "10%" or "€25 fixed" — omitted when unknown */
    commissionRate?: string
  }[]
  isInvoice?: boolean        // Quarterly invoice format
}

export function periodicSummaryHtml(data: SummaryData) {
  const revenue = `€${(data.totalRevenueCents / 100).toFixed(2)}`
  const commission = `€${(data.totalCommissionCents / 100).toFixed(2)}`
  const heading = data.isInvoice ? 'Commission Invoice' : 'Performance Summary'
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')

  const campaignRows = data.campaigns.map((c) => `
    <tr>
      <td style="padding:8px 8px 8px 0;font-size:13px;color:#374151;border-top:1px solid #f0ece6;">
        ${escapeHtml(c.name)}
        ${c.commissionRate ? `<span style="font-size:11px;color:#9ca3af;margin-left:4px;">${escapeHtml(c.commissionRate)}</span>` : ''}
      </td>
      <td style="padding:8px 4px;font-size:13px;text-align:right;color:#374151;border-top:1px solid #f0ece6;">${c.bookings}</td>
      <td style="padding:8px 4px;font-size:13px;text-align:right;color:#374151;border-top:1px solid #f0ece6;">€${(c.revenueCents / 100).toFixed(2)}</td>
      <td style="padding:8px 0 8px 4px;font-size:13px;text-align:right;font-weight:700;color:#059669;border-top:1px solid #f0ece6;">€${(c.commissionCents / 100).toFixed(2)}</td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0e9e0;background-image:url(${site}/textures/bg-sand.png);background-size:400px;background-repeat:repeat;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

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
            <p style="margin:0 0 6px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.4);">${escapeHtml(heading)}</p>
            <h1 style="margin:0;font-size:20px;font-weight:800;color:#ffffff;line-height:1.3;">${escapeHtml(data.periodLabel)}</h1>
          </td>
        </tr>

        <!-- ═══ BODY: white card ═══ -->
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:32px;border-radius:0 0 20px 20px;">

            <p style="margin:0 0 24px;font-size:15px;color:#374151;">Hey ${escapeHtml(data.recipientName)} 👋 — here&rsquo;s your ${data.isInvoice ? 'commission invoice' : 'performance summary'}.</p>

            <!-- KPI cards -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:28px;">
              <tr>
                <td bgcolor="#f7f4f0" style="background-color:#f7f4f0;border-radius:10px;padding:16px;text-align:center;width:33%;">
                  <div style="font-size:22px;font-weight:800;color:#1e1b4b;">${data.totalBookings}</div>
                  <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;">bookings</div>
                </td>
                <td style="width:8px;"></td>
                <td bgcolor="#f7f4f0" style="background-color:#f7f4f0;border-radius:10px;padding:16px;text-align:center;width:33%;">
                  <div style="font-size:22px;font-weight:800;color:#1e1b4b;">${revenue}</div>
                  <div style="font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;">revenue</div>
                </td>
                <td style="width:8px;"></td>
                <td bgcolor="#ecfdf5" style="background-color:#ecfdf5;border-radius:10px;padding:16px;text-align:center;width:33%;">
                  <div style="font-size:22px;font-weight:800;color:#059669;">${commission}</div>
                  <div style="font-size:10px;color:#059669;text-transform:uppercase;letter-spacing:1.5px;margin-top:4px;">${data.isInvoice ? 'total due' : 'commission'}</div>
                </td>
              </tr>
            </table>

            ${data.campaigns.length > 0 ? `
            <!-- Campaign breakdown -->
            <p style="margin:0 0 8px;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1.5px;font-weight:600;">by campaign</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <thead>
                <tr>
                  <th style="padding:6px 8px 6px 0;font-size:10px;color:#9ca3af;text-align:left;text-transform:uppercase;letter-spacing:1px;font-weight:600;">campaign</th>
                  <th style="padding:6px 4px;font-size:10px;color:#9ca3af;text-align:right;text-transform:uppercase;letter-spacing:1px;font-weight:600;">bookings</th>
                  <th style="padding:6px 4px;font-size:10px;color:#9ca3af;text-align:right;text-transform:uppercase;letter-spacing:1px;font-weight:600;">revenue</th>
                  <th style="padding:6px 0 6px 4px;font-size:10px;color:#9ca3af;text-align:right;text-transform:uppercase;letter-spacing:1px;font-weight:600;">commission</th>
                </tr>
              </thead>
              <tbody>
                ${campaignRows}
              </tbody>
            </table>
            ` : ''}

          </td>
        </tr>

        <!-- ═══ SPACER ═══ -->
        <tr><td style="height:24px;"></td></tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td style="text-align:center;padding:0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;line-height:1.6;">
              ${data.isInvoice
                ? 'this is an automated commission invoice — for payment questions, reply to this email.'
                : 'this is an automated report from Off Course Amsterdam.'}
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
