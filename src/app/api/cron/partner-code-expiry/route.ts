import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { postSlackText } from '@/lib/slack/send-notification'

/**
 * GET /api/cron/partner-code-expiry
 * Vercel Cron: runs every Monday at 09:00 UTC.
 *
 * Finds partner codes expiring in the next 14 days and pings Slack so an
 * admin can generate a fresh code (and print new QR stickers) before the
 * existing one lapses.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const now = new Date()
    const in14Days = new Date(now.getTime() + 14 * 86_400_000)

    const { data, error } = await supabase
      .from('partner_codes')
      .select('id, code, expires_at, partner_id, partners(id, name)')
      .eq('is_active', true)
      .gt('expires_at', now.toISOString())
      .lt('expires_at', in14Days.toISOString())
      .order('expires_at', { ascending: true })

    if (error) {
      console.error('[cron/partner-code-expiry] query error:', error)
      return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    }

    const rows = data ?? []
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'

    for (const row of rows) {
      const partner = Array.isArray(row.partners) ? row.partners[0] : row.partners
      const partnerName = partner?.name ?? 'Unknown partner'
      const expiryDate = new Date(row.expires_at).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
      const text = [
        `⏰ *Partner code expiring soon*`,
        `Partner: *${partnerName}*`,
        `Code: \`${row.code}\` — expires *${expiryDate}*`,
        `Generate a fresh code: ${siteUrl}/en/admin/partners/${row.partner_id}`,
      ].join('\n')
      await postSlackText(text)
    }

    return NextResponse.json({ ok: true, checked: rows.length })
  } catch (err) {
    console.error('[cron/partner-code-expiry]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
