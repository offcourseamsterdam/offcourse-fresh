import { NextResponse, after } from 'next/server'
import { verifySlackSignature } from '@/lib/slack/verify-request'
import { createAdminClient } from '@/lib/supabase/admin'
import { performClock } from '@/lib/scheduling/perform-clock'
import { draftMaintenanceTask } from '@/lib/ghost/maintenance-drafter'

/**
 * `/in` and `/out` clock hours.
 * `/defect` (or appending a note like `/in fender kapot`) reports a defect directly to Maintenance.
 */
const COMMAND_ACTION: Record<string, 'in' | 'out' | 'defect'> = {
  '/in': 'in',
  '/out': 'out',
  '/checkin': 'in',
  '/checkout': 'out',
  '/defect': 'defect',
  '/maint': 'defect',
}

function slackText(text: string, ephemeral = true) {
  return NextResponse.json(
    { response_type: ephemeral ? 'ephemeral' : 'in_channel', text },
    { status: 200 },
  )
}

export async function POST(req: Request): Promise<NextResponse> {
  const raw = await req.text()
  const valid = verifySlackSignature(
    raw,
    req.headers.get('x-slack-request-timestamp'),
    req.headers.get('x-slack-signature'),
  )
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URLSearchParams(raw)
  const command = params.get('command') ?? ''
  const text = (params.get('text') ?? '').trim()
  const slackUserId = params.get('user_id') ?? ''

  const action = COMMAND_ACTION[command]
  if (!action) return slackText(`Unknown command ${command || '(none)'} — try /in, /out, or /defect.`)

  const supabase = createAdminClient()
  const { data: staffRow } = await supabase
    .from('staff')
    .select('id, name, hourly_rate_cents')
    .eq('slack_member_id', slackUserId)
    .eq('is_active', true)
    .single()

  if (!staffRow) {
    return slackText(
      "Your Slack account isn't linked to a staff record yet. Ask Beer to link it in Admin → Scheduling → Staff.",
    )
  }

  // ── /defect COMMAND ───────────────────────────────────────────────────────
  if (action === 'defect') {
    if (!text) {
      return slackText('Gebruik: /defect [beschrijving van het probleem of defect op de boot].')
    }

    after(async () => {
      await draftMaintenanceTask({
        slackEventId: `cmd_${Date.now()}_${slackUserId}`,
        text: `[Gemeld door ${staffRow.name} via /defect]: ${text}`,
        reporter: staffRow.name || 'Captain',
        source: 'slack',
      })
    })

    return slackText(
      `🔧 Bedankt ${staffRow.name}! Je melding "${text}" is direct geregistreerd in Maintenance en gemeld bij de manager.`,
      false,
    )
  }

  // ── /in AND /out COMMANDS ─────────────────────────────────────────────────
  try {
    const outcome = await performClock(supabase, staffRow, action, 'slack')

    // If captain passed a note or reported something during clock in/out
    if (text) {
      // Save note to time_entries if entryId exists
      if (outcome.entryId) {
        await supabase
          .from('time_entries')
          .update({ note: text })
          .eq('id', outcome.entryId)
      }

      // Check if text looks like a defect/maintenance issue
      const looksLikeDefect = /defect|kapot|stuk|fender|accu|batterij|motor|lek|schade|kraak|repareer|probleem|warning|issue/i.test(text)
      if (looksLikeDefect) {
        after(async () => {
          await draftMaintenanceTask({
            slackEventId: `clock_${Date.now()}_${slackUserId}`,
            text: `[Gemeld door ${staffRow.name} tijdens ${action === 'in' ? 'check-in' : 'check-out'}]: ${text}`,
            reporter: staffRow.name || 'Captain',
            source: 'slack',
          })
        })
      }
    }

    const reply = text
      ? `${outcome.message}\n📝 Notitie genoteerd: "${text}"${/defect|kapot|stuk|fender|accu|motor|lek|schade/i.test(text) ? ' (ook doorgestuurd naar Maintenance 🔧)' : ''}`
      : outcome.message

    return slackText(reply, false)
  } catch (err) {
    console.error('[slack/commands] performClock error:', err)
    return slackText('Something went wrong — try again or use the captain portal.')
  }
}
