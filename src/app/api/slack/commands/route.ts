import { NextResponse } from 'next/server'
import { verifySlackRequest } from '@/lib/slack/verify-request'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { performClock } from '@/lib/scheduling/perform-clock'

function serviceClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** Respond to Slack immediately (3-second deadline) and return plain text. */
function slackText(text: string, ephemeral = true) {
  return NextResponse.json(
    { response_type: ephemeral ? 'ephemeral' : 'in_channel', text },
    { status: 200 },
  )
}

export async function POST(req: Request): Promise<NextResponse> {
  // Slack re-sends the raw body for signature verification; clone before reading.
  const cloned = req.clone()
  const valid = await verifySlackRequest(cloned)
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await req.text()
  const params = new URLSearchParams(raw)
  const command = params.get('command') ?? ''         // /checkin or /checkout
  const slackUserId = params.get('user_id') ?? ''

  const action: 'in' | 'out' = command === '/checkout' ? 'out' : 'in'

  const supabase = serviceClient()
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id, hourly_rate_cents')
    .eq('slack_member_id', slackUserId)
    .eq('is_active', true)
    .single()

  if (!staffRow) {
    return slackText(
      "Your Slack account isn't linked to a staff record yet. Ask Beer to link it in Admin → Scheduling → Staff.",
    )
  }

  try {
    const outcome = await performClock(supabase, staffRow, action, 'slack')
    return slackText(outcome.message, false)
  } catch (err) {
    console.error('[slack/commands] performClock error:', err)
    return slackText('Something went wrong — try again or use the captain portal.')
  }
}
