import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { periodicSummaryHtml } from '@/emails/PeriodicSummary'
import { Resend } from 'resend'

/**
 * GET /api/cron/quarterly-invoice
 * Vercel Cron: runs on 1st of Jan, Apr, Jul, Oct at 6:00 UTC
 * Sends per-partner quarterly invoice summaries.
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
      .select('*, partners(*)')
      .eq('notify_quarterly', true)
      .not('partner_id', 'is', null)

    if (!settings?.length) {
      return NextResponse.json({ ok: true, sent: 0 })
    }

    // Previous quarter range
    const now = new Date()
    const currentQuarter = Math.floor(now.getMonth() / 3)
    const prevQuarter = currentQuarter === 0 ? 3 : currentQuarter - 1
    const prevYear = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear()
    const from = new Date(prevYear, prevQuarter * 3, 1)
    const to = new Date(prevYear, prevQuarter * 3 + 3, 1)
    const quarterLabel = `Q${prevQuarter + 1} ${prevYear}`

    let sent = 0

    for (const setting of settings) {
      const partner = (setting as Record<string, unknown>).partners as { name: string; email?: string } | null
      if (!partner) continue

      const recipients = setting.email_recipients ?? []
      if (recipients.length === 0 && partner.email) {
        recipients.push(partner.email)
      }
      if (recipients.length === 0) continue

      const html = periodicSummaryHtml({
        recipientName: partner.name,
        periodLabel: quarterLabel,
        totalBookings: 0,
        totalRevenueCents: 0,
        totalCommissionCents: 0,
        campaigns: [],
        isInvoice: true,
      })

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
