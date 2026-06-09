import { escapeHtml } from '@/lib/utils'

interface UpsellExtra {
  name: string
  description: string | null
  image_url: string | null
  price_display: string
}

interface ExtrasUpsellEmailData {
  customerName: string
  listingTitle: string
  bookingDate: string
  startTime: string
  guestCount: number
  extrasPageUrl: string
  featuredExtras: UpsellExtra[]
  totalExtras?: number
  siteUrl?: string
}

export function extrasUpsellEmailHtml(data: ExtrasUpsellEmailData): string {
  const firstName = escapeHtml(data.customerName.split(' ')[0])
  const site = (data.siteUrl ?? 'https://offcourseamsterdam.com').replace(/\/$/, '')
  const moreCount = (data.totalExtras ?? data.featuredExtras.length) - data.featuredExtras.length

  // Build food photo grid (2 per row, up to 4 items)
  const items = data.featuredExtras.slice(0, 4)
  const photoRows: string[] = []
  for (let i = 0; i < items.length; i += 2) {
    const pair = [items[i], items[i + 1]].map((e, j) => {
      if (!e) return '<td style="width:50%;padding:4px;"></td>'
      const pad = j === 0 ? 'padding:4px 6px 4px 0' : 'padding:4px 0 4px 6px'
      const photo = e.image_url
        ? `<img src="${escapeHtml(e.image_url)}" alt="${escapeHtml(e.name)}" width="260" style="display:block;width:100%;height:160px;object-fit:cover;border-radius:12px;" />`
        : `<div style="width:100%;height:160px;background:#e8e2d9;border-radius:12px;font-size:36px;text-align:center;line-height:160px;">🍽️</div>`
      return `
        <td style="width:50%;${pad};vertical-align:top;">
          ${photo}
          <p style="margin:8px 0 2px;font-size:13px;font-weight:700;color:#1e1b4b;line-height:1.3;">${escapeHtml(e.name.toLowerCase())}</p>
          <p style="margin:0;font-size:12px;color:#6b7280;font-weight:600;">${escapeHtml(e.price_display)}</p>
        </td>`
    })
    photoRows.push(`<tr>${pair.join('')}</tr>`)
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your cruise is in 2 days 🛥️</title>
</head>
<body style="margin:0;padding:0;background-color:#f0e9e0;background-image:url(${site}/textures/bg-sand.png);background-size:400px;background-repeat:repeat;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <!-- Preheader (hidden preview text in inbox) -->
  <div style="display:none;max-height:0;overflow:hidden;color:#f0e9e0;">snacks on a boat hit different. we've been thinking about your cruise.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:32px 16px 48px;">

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">

        <!-- ═══ HEADER: deep indigo + logo ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:36px 32px 28px;border-radius:20px 20px 0 0;text-align:center;">
            <a href="https://offcourseamsterdam.com" style="display:inline-block;">
              <img
                src="${site}/logos/offcourse-vertical.png"
                alt="Off Course Amsterdam"
                width="80"
                style="display:block;margin:0 auto;width:80px;height:auto;"
              />
            </a>
          </td>
        </tr>

        <!-- ═══ CRUISE STRIP: still indigo ═══ -->
        <tr>
          <td bgcolor="#1e1b4b" style="background-color:#1e1b4b;padding:0 32px 36px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.08);">
            <p style="margin:0 0 8px;font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.4);">your cruise is in 2 days&nbsp;&nbsp;🛥️</p>
            <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#ffffff;line-height:1.25;">${escapeHtml(data.listingTitle)}</h1>
            <p style="margin:0;font-size:13px;color:rgba(255,255,255,0.6);letter-spacing:0.2px;">
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
            <p style="margin:0 0 12px;font-size:17px;font-weight:700;color:#1e1b4b;">hey ${firstName} 👋</p>
            <p style="margin:0 0 10px;font-size:15px;color:#374151;line-height:1.7;">
              your cruise is almost here — and we've been thinking about snacks.
            </p>
            <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
              we can have food and drinks ready on the boat so you don't think about a thing. just pick what you want and we'll take care of the rest.
            </p>

            <!-- Food photo grid -->
            ${items.length > 0 ? `
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:${moreCount > 0 ? '12px' : '28px'};">
              ${photoRows.join('\n              ')}
            </table>
            ${moreCount > 0 ? `<p style="margin:0 0 28px;font-size:13px;color:#9ca3af;text-align:center;">+ ${moreCount} more option${moreCount === 1 ? '' : 's'} on the page</p>` : ''}` : ''}

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
              <tr>
                <td align="center" style="padding:4px 0;">
                  <a href="${escapeHtml(data.extrasPageUrl)}"
                     style="display:inline-block;background-color:#1e1b4b;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;padding:16px 40px;border-radius:50px;letter-spacing:0.3px;line-height:1;">
                    pre-order food &amp; drinks&nbsp;&nbsp;→
                  </a>
                </td>
              </tr>
            </table>

            <!-- Reassurance -->
            <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;line-height:1.6;">
              💳 no payment now — you settle on the day of your cruise
            </p>

          </td>
        </tr>

        <!-- ═══ SPACER ═══ -->
        <tr><td style="height:24px;"></td></tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td style="text-align:center;padding:0 16px;">
            <p style="margin:0 0 4px;font-size:11px;color:#9ca3af;line-height:1.6;">
              Off Course Amsterdam &mdash; your friend with a boat
            </p>
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
