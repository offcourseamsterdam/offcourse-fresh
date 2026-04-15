import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { periodicSummaryHtml } from '@/emails/PeriodicSummary'
import { Resend } from 'resend'

/**
 * GET /api/cron/weekly-summary
 * Vercel Cron: runs every Monday at 6:00 UTC (8:00 CET)
 * Sends weekly performance summaries to channels/partners with notify_weekly = true.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const resend = new Resend(process.env.RESEND_API_KEY!)

    // Get notification settings where weekly is enabled
    const { data: settings } = await supabase
      .from('notification_settings')
      .select('*, channels(*), partners(*)')
      .eq('notify_weekly', true)

    if (!settings?.length) {
      return NextResponse.json({ ok: true, sent: 0 })
    }

    // Date range: previous 7 days
    const to = new Date()
    const from = new Date(to.getTime() - 7 * 86_400_000)
    const periodLabel = `Week of ${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

    let sent = 0

    for (const setting of settings) {
      const recipients = setting.email_recipients ?? []
      if (recipients.length === 0) continue

      const name = (setting as Record<string, unknown>).channels
        ? ((setting as Record<string, unknown>).channels as { name: string }).name
        : ((setting as Record<string, unknown>).partners as { name: string })?.name ?? 'Partner'

      // For now, send a simple summary (detailed query would filter by partner/channel)
      const html = periodicSummaryHtml({
        recipientName: name,
        periodLabel,
        totalBookings: 0, // TODO: query actual data per partner/channel
        totalRevenueCents: 0,
        totalCommissionCents: 0,
        campaigns: [],
      })

      await resend.emails.send({
        from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
        to: recipients,
        subject: `Weekly Report — Off Course Amsterdam (${periodLabel})`,
        html,
      })
      sent++
    }

    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    console.error('[cron/weekly-summary]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
