import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { periodicSummaryHtml } from '@/emails/PeriodicSummary'
import { getNotificationSettings, buildSummaryForRecipient } from '@/lib/tracking/cron-queries'
import { Resend } from 'resend'

/**
 * GET /api/cron/weekly-summary
 * Vercel Cron: runs every Monday at 6:00 UTC (8:00 CET)
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const resend = new Resend(process.env.RESEND_API_KEY!)

    const settings = await getNotificationSettings(supabase, 'notify_weekly')
    if (!settings.length) return NextResponse.json({ ok: true, sent: 0 })

    // Previous 7 days
    const to = new Date()
    const from = new Date(to.getTime() - 7 * 86_400_000)
    const periodLabel = `Week of ${from.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

    let sent = 0

    for (const setting of settings) {
      const recipients = setting.email_recipients
      if (!recipients.length) continue

      const summary = await buildSummaryForRecipient(supabase, setting, from, to, periodLabel)
      if (!summary) continue

      const html = periodicSummaryHtml(summary)

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
