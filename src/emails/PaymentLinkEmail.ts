function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function paymentLinkEmailHtml(data: {
  customerName: string
  listingTitle: string
  bookingDate: string
  startTime: string
  guestCount: number
  amountCents: number
  paymentUrl: string
}) {
  const amount = `€${(data.amountCents / 100).toFixed(2)}`

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:32px auto;">
    <tr><td style="background:#18181b;padding:20px 24px;border-radius:12px 12px 0 0;">
      <span style="color:#fff;font-size:14px;font-weight:700;">Off Course Amsterdam</span>
    </td></tr>
    <tr><td style="background:#fff;padding:28px 24px;border:1px solid #e4e4e7;border-top:0;">
      <p style="margin:0 0 12px;font-size:16px;font-weight:600;color:#18181b;">Hey ${escapeHtml(data.customerName)},</p>
      <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
        Your booking is ready — pay below to lock in your spot on the water.
      </p>
      <table width="100%" style="font-size:13px;color:#3f3f46;border-collapse:collapse;margin-bottom:24px;">
        <tr><td style="padding:6px 0;color:#71717a;">Cruise</td><td style="padding:6px 0;font-weight:600;">${escapeHtml(data.listingTitle)}</td></tr>
        <tr><td style="padding:6px 0;color:#71717a;">Date</td><td style="padding:6px 0;">${escapeHtml(data.bookingDate)}</td></tr>
        <tr><td style="padding:6px 0;color:#71717a;">Time</td><td style="padding:6px 0;">${escapeHtml(data.startTime)}</td></tr>
        <tr><td style="padding:6px 0;color:#71717a;">Guests</td><td style="padding:6px 0;">${data.guestCount}</td></tr>
        <tr><td style="padding:6px 0;color:#71717a;border-top:1px solid #f4f4f5;">Total</td><td style="padding:6px 0;font-weight:700;border-top:1px solid #f4f4f5;">${amount}</td></tr>
      </table>
      <div style="text-align:center;margin:28px 0;">
        <a href="${escapeHtml(data.paymentUrl)}"
           style="display:inline-block;background:#18181b;color:#fff;font-size:15px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;">
          Pay now →
        </a>
      </div>
      <p style="margin:0;font-size:12px;color:#a1a1aa;text-align:center;">
        ⏳ This link expires in 24 hours. After that, your reservation is automatically released.
      </p>
    </td></tr>
    <tr><td style="padding:16px 24px;border:1px solid #e4e4e7;border-top:0;border-radius:0 0 12px 12px;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#a1a1aa;">
        Questions? Email us at <a href="mailto:cruise@offcourseamsterdam.com" style="color:#71717a;">cruise@offcourseamsterdam.com</a>
      </p>
    </td></tr>
  </table>
</body>
</html>`
}
