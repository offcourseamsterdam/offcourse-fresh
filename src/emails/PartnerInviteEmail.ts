function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

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
  const name = data.partnerName // use the full partner/company name

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:32px auto;">
    <tr><td style="background:#18181b;padding:20px 24px;border-radius:12px 12px 0 0;">
      <span style="color:#fff;font-size:14px;font-weight:700;">Off Course Amsterdam</span>
      <span style="color:#71717a;font-size:12px;margin-left:8px;">Partner Portal</span>
    </td></tr>
    <tr><td style="background:#fff;padding:32px 24px;border:1px solid #e4e4e7;border-top:0;">
      <h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#18181b;">You&rsquo;re invited to the partner portal</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#3f3f46;line-height:1.6;">
        Hey ${escapeHtml(name)},<br><br>
        You&rsquo;ve been invited to the Off Course Amsterdam partner portal &mdash; your personal dashboard
        to track clicks, bookings, and commissions across all your campaigns.
      </p>
      <p style="margin:0 0 28px;font-size:14px;color:#3f3f46;line-height:1.6;">
        Click the button below to set up your account. The link is valid for 24&nbsp;hours.
      </p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
        <tr><td style="background:#18181b;border-radius:8px;">
          <a href="${escapeHtml(data.inviteUrl)}" style="display:block;padding:14px 28px;color:#fff;font-size:14px;font-weight:600;text-decoration:none;">
            Access my partner portal &rarr;
          </a>
        </td></tr>
      </table>
      <p style="margin:0;font-size:12px;color:#a1a1aa;">
        If you didn&rsquo;t expect this invite, you can safely ignore it.
      </p>
    </td></tr>
    <tr><td style="padding:16px 24px;border:1px solid #e4e4e7;border-top:0;border-radius:0 0 12px 12px;background:#fafafa;">
      <p style="margin:0;font-size:11px;color:#a1a1aa;">Off Course Amsterdam &bull; your friend with a boat</p>
    </td></tr>
  </table>
</body>
</html>`
}
