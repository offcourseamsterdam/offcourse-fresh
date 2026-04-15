import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { periodicSummaryHtml } from '@/emails/PeriodicSummary'
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

    const { data: settings } = await supabase
      .from('notification_settings')
      .select('*, channels(*), partners(*)')
      .eq('notify_monthly', true)

    if (!settings?.length) {
      return NextResponse.json({ ok: true, sent: 0 })
    }

    // Previous month range
    const now = new Date()
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthName = from.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

    let sent = 0

    for (const setting of settings) {
      const recipients = setting.email_recipients ?? []
      if (recipients.length === 0) continue

      const name = (setting as Record<string, unknown>).channels
        ? ((setting as Record<string, unknown>).channels as { name: string }).name
        : ((setting as Record<string, unknown>).partners as { name: string })?.name ?? 'Partner'

      const html = periodicSummaryHtml({
        recipientName: name,
        periodLabel: monthName,
        totalBookings: 0,
        totalRevenueCents: 0,
        totalCommissionCents: 0,
        campaigns: [],
      })

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
