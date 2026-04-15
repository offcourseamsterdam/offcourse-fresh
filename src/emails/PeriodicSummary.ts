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
  }[]
  isInvoice?: boolean        // Quarterly invoice format
}

export function periodicSummaryHtml(data: SummaryData) {
  const revenue = `€${(data.totalRevenueCents / 100).toFixed(2)}`
  const commission = `€${(data.totalCommissionCents / 100).toFixed(2)}`
  const heading = data.isInvoice ? 'Commission Invoice' : 'Performance Summary'

  const campaignRows = data.campaigns.map((c) => `
    <tr>
      <td style="padding:6px 0;font-size:12px;color:#3f3f46;">${c.name}</td>
      <td style="padding:6px 0;font-size:12px;text-align:right;color:#3f3f46;">${c.bookings}</td>
      <td style="padding:6px 0;font-size:12px;text-align:right;color:#3f3f46;">€${(c.revenueCents / 100).toFixed(2)}</td>
      <td style="padding:6px 0;font-size:12px;text-align:right;font-weight:600;color:#059669;">€${(c.commissionCents / 100).toFixed(2)}</td>
    </tr>
  `).join('')

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:32px auto;">
    <tr><td style="background:#18181b;padding:20px 24px;border-radius:12px 12px 0 0;">
      <span style="color:#fff;font-size:14px;font-weight:700;">Off Course Amsterdam</span>
      <span style="color:#71717a;font-size:12px;margin-left:8px;">${heading}</span>
    </td></tr>
    <tr><td style="background:#fff;padding:24px;border:1px solid #e4e4e7;border-top:0;">
      <p style="margin:0 0 4px;font-size:13px;color:#71717a;">Hi ${data.recipientName},</p>
      <p style="margin:0 0 20px;font-size:14px;font-weight:600;color:#18181b;">${data.periodLabel}</p>

      <!-- KPIs -->
      <table width="100%" style="margin-bottom:20px;border-collapse:collapse;">
        <tr>
          <td style="padding:12px;background:#fafafa;border-radius:8px;text-align:center;width:33%;">
            <div style="font-size:20px;font-weight:700;color:#18181b;">${data.totalBookings}</div>
            <div style="font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:1px;">Bookings</div>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:12px;background:#fafafa;border-radius:8px;text-align:center;width:33%;">
            <div style="font-size:20px;font-weight:700;color:#18181b;">${revenue}</div>
            <div style="font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:1px;">Revenue</div>
          </td>
          <td style="width:8px;"></td>
          <td style="padding:12px;background:#ecfdf5;border-radius:8px;text-align:center;width:33%;">
            <div style="font-size:20px;font-weight:700;color:#059669;">${commission}</div>
            <div style="font-size:10px;color:#059669;text-transform:uppercase;letter-spacing:1px;">${data.isInvoice ? 'Total Due' : 'Commission'}</div>
          </td>
        </tr>
      </table>

      ${data.campaigns.length > 0 ? `
      <!-- Campaign breakdown -->
      <p style="margin:0 0 8px;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:1px;font-weight:600;">By Campaign</p>
      <table width="100%" style="border-collapse:collapse;border-top:1px solid #f4f4f5;">
        <thead>
          <tr>
            <th style="padding:6px 0;font-size:10px;color:#a1a1aa;text-align:left;text-transform:uppercase;letter-spacing:1px;">Campaign</th>
            <th style="padding:6px 0;font-size:10px;color:#a1a1aa;text-align:right;text-transform:uppercase;letter-spacing:1px;">Bookings</th>
            <th style="padding:6px 0;font-size:10px;color:#a1a1aa;text-align:right;text-transform:uppercase;letter-spacing:1px;">Revenue</th>
            <th style="padding:6px 0;font-size:10px;color:#a1a1aa;text-align:right;text-transform:uppercase;letter-spacing:1px;">Commission</th>
          </tr>
        </thead>
        <tbody style="border-top:1px solid #f4f4f5;">
          ${campaignRows}
        </tbody>
      </table>
      ` : ''}
    </td></tr>
    <tr><td style="padding:16px 24px;border:1px solid #e4e4e7;border-top:0;border-radius:0 0 12px 12px;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#a1a1aa;">
        ${data.isInvoice
          ? 'This is an automated commission summary. For payment questions, reply to this email.'
          : 'This is an automated report from Off Course Amsterdam.'}
      </p>
    </td></tr>
  </table>
</body>
</html>`
}
