import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { periodicSummaryHtml } from '@/emails/PeriodicSummary'
import { getNotificationSettings, buildSummaryForRecipient } from '@/lib/tracking/cron-queries'
import { Resend } from 'resend'

/**
 * GET /api/cron/monthly-summary
 * Vercel Cron: runs on 1st of each month at 6:00 UTC
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const resend = new Resend(process.env.RESEND_API_KEY!)

    const settings = await getNotificationSettings(supabase, 'notify_monthly')
    if (!settings.length) return NextResponse.json({ ok: true, sent: 0 })

    // Previous calendar month
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthName = from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

    let sent = 0

    for (const setting of settings) {
      const recipients = setting.email_recipients
      if (!recipients.length) continue

      const summary = await buildSummaryForRecipient(supabase, setting, from, to, monthName)
      if (!summary) continue

      const html = periodicSummaryHtml(summary)

      await resend.emails.send({
        from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
        to: recipients,
        subject: `Monthly Report — Off Course Amsterdam (${monthName})`,
        html,
      })
      sent++
    }

    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    console.error('[cron/monthly-summary]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
