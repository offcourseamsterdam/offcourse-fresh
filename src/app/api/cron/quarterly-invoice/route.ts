import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { periodicSummaryHtml } from '@/emails/PeriodicSummary'
import { getNotificationSettings, buildSummaryForRecipient } from '@/lib/tracking/cron-queries'
import { Resend } from 'resend'

/**
 * GET /api/cron/quarterly-invoice
 * Vercel Cron: runs on 1st of Jan, Apr, Jul, Oct at 6:00 UTC
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const resend = new Resend(process.env.RESEND_API_KEY!)

    const settings = await getNotificationSettings(supabase, 'notify_quarterly')
    if (!settings.length) return NextResponse.json({ ok: true, sent: 0 })

    // Previous quarter
    const now = new Date()
    const currentQuarter = Math.floor(now.getMonth() / 3)
    const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1
    const prevYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear()
    const from = new Date(prevYear, prevQuarter * 3, 1)
    const to = new Date(prevYear, prevQuarter * 3 + 3, 1)
    const quarterLabel = `Q${prevQuarter + 1} ${prevYear}`

    let sent = 0

    for (const setting of settings) {
      // For quarterly invoices, also check partner email as fallback
      let recipients = [...setting.email_recipients]
      if (recipients.length === 0 && setting.partner_id) {
        const { data: partner } = await supabase
          .from('partners')
          .select('email')
          .eq('id', setting.partner_id)
          .single()
        if (partner?.email) recipients.push(partner.email)
      }
      if (!recipients.length) continue

      const summary = await buildSummaryForRecipient(supabase, setting, from, to, quarterLabel, true)
      if (!summary) continue

      const html = periodicSummaryHtml(summary)

      await resend.emails.send({
        from: 'Off Course Amsterdam <cruise@offcourseamsterdam.com>',
        to: recipients,
        subject: `${quarterLabel} Commission Summary — Off Course Amsterdam`,
        html,
      })
      sent++
    }

    return NextResponse.json({ ok: true, sent })
  } catch (err) {
    console.error('[cron/quarterly-invoice]', err)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
