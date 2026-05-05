function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Per-booking notification email for partners/affiliates.
 * Sent immediately when a booking is attributed to their channel.
 */
export function bookingNotificationHtml(data: {
  partnerName: string
  channelName: string
  campaignName?: string
  listingTitle: string
  bookingDate: string
  guestCount: number
  amountCents: number
  commissionCents: number
  /** e.g. "10%" or "€25 fixed" — shown next to the commission row */
  commissionRate?: string
}) {
  const amount = `€${(data.amountCents / 100).toFixed(2)}`
  const commission = `€${(data.commissionCents / 100).toFixed(2)}`

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:32px auto;">
    <tr><td style="background:#18181b;padding:20px 24px;border-radius:12px 12px 0 0;">
      <span style="color:#fff;font-size:14px;font-weight:700;">Off Course Amsterdam</span>
      <span style="color:#71717a;font-size:12px;margin-left:8px;">Booking Alert</span>
    </td></tr>
    <tr><td style="background:#fff;padding:24px;border:1px solid #e4e4e7;border-top:0;">
      <p style="margin:0 0 16px;font-size:14px;color:#18181b;">
        New booking via <strong>${escapeHtml(data.channelName)}</strong>${data.campaignName ? ` / ${escapeHtml(data.campaignName)}` : ''}
      </p>
      <table width="100%" style="font-size:13px;color:#3f3f46;border-collapse:collapse;">
        <tr><td style="padding:6px 0;color:#71717a;">Cruise</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(data.listingTitle)}</td></tr>
        <tr><td style="padding:6px 0;color:#71717a;">Date</td><td style="padding:6px 0;">${escapeHtml(data.bookingDate)}</td></tr>
        <tr><td style="padding:6px 0;color:#71717a;">Guests</td><td style="padding:6px 0;">${data.guestCount}</td></tr>
        <tr><td style="padding:6px 0;color:#71717a;">Amount</td><td style="padding:6px 0;">${amount}</td></tr>
        <tr>
          <td style="padding:6px 0;color:#71717a;border-top:1px solid #f4f4f5;">Commission</td>
          <td style="padding:6px 0;font-weight:700;color:#059669;border-top:1px solid #f4f4f5;">
            ${commission}${data.commissionRate ? ` <span style="font-size:11px;font-weight:400;color:#a1a1aa;">(${escapeHtml(data.commissionRate)})</span>` : ''}
          </td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 24px;border:1px solid #e4e4e7;border-top:0;border-radius:0 0 12px 12px;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#a1a1aa;">
        This notification was sent because ${escapeHtml(data.partnerName)} has per-booking alerts enabled.
      </p>
    </td></tr>
  </table>
</body>
</html>`
}
