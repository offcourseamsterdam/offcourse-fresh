import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { NOTIFICATION_CATALOG } from '@/lib/slack/catalog'

export async function GET() {
  const authError = await requireAdmin()
  if (authError) return authError

  const supabase = createAdminClient()
  const [settingsResult, logResult] = await Promise.all([
    supabase.from('slack_notification_settings').select('id, enabled, notes, updated_at'),
    supabase
      .from('slack_message_log')
      .select('id, notification_type, direction, channel, recipient_type, message_preview, triggered_by, sent_at')
      .order('sent_at', { ascending: false })
      .limit(100),
  ])

  const settingsMap: Record<string, { enabled: boolean; notes: string | null; updated_at: string }> = {}
  for (const row of settingsResult.data ?? []) {
    settingsMap[row.id] = { enabled: row.enabled, notes: row.notes, updated_at: row.updated_at }
  }

  const envStatus = {
    SLACK_WEBHOOK_URL: !!process.env.SLACK_WEBHOOK_URL,
    SLACK_BOT_TOKEN: !!process.env.SLACK_BOT_TOKEN,
    SLACK_SIGNING_SECRET: !!process.env.SLACK_SIGNING_SECRET,
    SLACK_MAINTENANCE_CHANNEL_ID: !!process.env.SLACK_MAINTENANCE_CHANNEL_ID,
    SLACK_OPS_CHANNEL: process.env.SLACK_OPS_CHANNEL || '#bookings',
    AI_COST_ALERT_SLACK_ID: process.env.AI_COST_ALERT_SLACK_ID || 'D08PRAXD13R (default)',
  }

  return NextResponse.json({
    ok: true,
    data: {
      catalog: NOTIFICATION_CATALOG,
      settings: settingsMap,
      recentLog: logResult.data ?? [],
      envStatus,
    },
  })
}

export async function PATCH(req: Request) {
  const authError = await requireAdmin()
  if (authError) return authError

  const body = await req.json() as { id: string; enabled: boolean; notes?: string }
  if (!body.id || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'id and enabled required' }, { status: 400 })
  }

  // Validate id exists in catalog
  const valid = NOTIFICATION_CATALOG.some(e => e.id === body.id)
  if (!valid) {
    return NextResponse.json({ error: 'Unknown notification type' }, { status: 400 })
  }

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('slack_notification_settings')
    .upsert({ id: body.id, enabled: body.enabled, notes: body.notes ?? null, updated_at: new Date().toISOString() })

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
