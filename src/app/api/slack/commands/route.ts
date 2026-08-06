import { NextResponse } from 'next/server'
import { verifySlackSignature } from '@/lib/slack/verify-request'
import { createAdminClient } from '@/lib/supabase/admin'
import { performClock } from '@/lib/scheduling/perform-clock'

/**
 * `/in` and `/out` are the ones captains actually type — short enough to fire
 * off one-handed while stepping onto a boat. `/checkin` and `/checkout` stay
 * registered as aliases so anyone with the old muscle memory (or an old
 * bookmark) still works.
 */
const COMMAND_ACTION: Record<string, 'in' | 'out'> = {
  '/in': 'in',
  '/out': 'out',
  '/checkin': 'in',
  '/checkout': 'out',
}

/** Respond to Slack immediately (3-second deadline) and return plain text. */
function slackText(text: string, ephemeral = true) {
  return NextResponse.json(
    { response_type: ephemeral ? 'ephemeral' : 'in_channel', text },
    { status: 200 },
  )
}

export async function POST(req: Request): Promise<NextResponse> {
  // Read the raw body ONCE — the signature is computed over these exact bytes.
  const raw = await req.text()
  const valid = verifySlackSignature(
    raw,
    req.headers.get('x-slack-request-timestamp'),
    req.headers.get('x-slack-signature'),
  )
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URLSearchParams(raw)
  const command = params.get('command') ?? ''
  const slackUserId = params.get('user_id') ?? ''

  const action = COMMAND_ACTION[command]
  if (!action) return slackText(`Unknown command ${command || '(none)'} — try /checkin or /checkout.`)

  const supabase = createAdminClient()
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
