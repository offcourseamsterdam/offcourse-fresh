import { NextResponse, after } from 'next/server'
import { verifySlackSignature } from '@/lib/slack/verify-request'
import { createAdminClient } from '@/lib/supabase/admin'
import { performClock } from '@/lib/scheduling/perform-clock'
import { draftMaintenanceTask } from '@/lib/ghost/maintenance-drafter'
import { amsterdamToday } from '@/lib/utils'

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
  const staff = staffRow

  // Helper to resolve boat from message text or skipper shift today
  async function resolveBoatForStaff(msgText: string, staffId: string): Promise<{ boatId: string | null; boatName: string | null; ambiguous: boolean; candidateNames?: string[] }> {
    const { data: allBoats } = await supabase.from('boats').select('id, name').order('name')
    const boatList = allBoats ?? []

    // 1. Did the skipper mention Diana or Curaçao in their text?
    const lower = msgText.toLowerCase()
    const mentionedBoat = boatList.find(b => {
      const bLower = b.name.toLowerCase()
      if (lower.includes(bLower)) return true
      if (bLower === 'curaçao' && (lower.includes('curacao') || lower.includes('curacao'))) return true
      return false
    })
    if (mentionedBoat) {
      return { boatId: mentionedBoat.id, boatName: mentionedBoat.name, ambiguous: false }
    }

    // 2. Resolve from skipper's shift today
    const today = amsterdamToday(0)
    const { data: todayShifts } = await supabase
      .from('shifts')
      .select('boat_id, boats(name)')
      .eq('staff_id', staffId)
      .eq('date', today)
      .in('status', ['assigned', 'confirmed'])

    const distinctBoatIds = Array.from(new Set((todayShifts ?? []).map(s => s.boat_id).filter((id): id is string => Boolean(id))))
    if (distinctBoatIds.length === 1) {
      const bId = distinctBoatIds[0]
      const bName = (todayShifts?.[0]?.boats as any)?.name ?? boatList.find(b => b.id === bId)?.name ?? 'de boot'
      return { boatId: bId, boatName: bName, ambiguous: false }
    }

    // 0 shifts or multiple boats today -> ambiguous, must clarify!
    return {
      boatId: null,
      boatName: null,
      ambiguous: true,
      candidateNames: boatList.map(b => b.name),
    }
  }

  // ── /defect COMMAND ───────────────────────────────────────────────────────
  if (action === 'defect') {
    if (!text) {
      return slackText('Gebruik: /defect [beschrijving van het probleem of defect op de boot].\nBijv: `/defect Diana: fenderlijn gebroken` of `/defect Curaçao: acculader laadt langzaam`.')
    }

    const boatResolution = await resolveBoatForStaff(text, staff.id)
    if (boatResolution.ambiguous) {
      const options = (boatResolution.candidateNames ?? ['Diana', 'Curaçao']).map(n => `• \`/defect ${n}: ${text}\``).join('\n')
      return slackText(
        `❓ *Op welke boot is dit defect?*\nJe staat vandaag niet op 1 specifieke boot ingepland. Geef alsjeblieft de bootnaam mee:\n${options}`,
      )
    }

    after(async () => {
      await draftMaintenanceTask({
        slackEventId: `cmd_${Date.now()}_${slackUserId}`,
        text: `[Gemeld door ${staff.name} via /defect]: ${text}`,
        reporter: staff.name || 'Captain',
        source: 'slack',
        boatId: boatResolution.boatId,
        boatName: boatResolution.boatName,
      })
    })

    return slackText(
      `🔧 Bedankt ${staff.name}! Je melding voor de *${boatResolution.boatName}* ("${text}") is direct geregistreerd in Maintenance en gemeld bij de manager.`,
      false,
    )
  }

  // ── /in AND /out COMMANDS ─────────────────────────────────────────────────
  try {
    const outcome = await performClock(supabase, staff, action, 'slack')

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
        const boatResolution = await resolveBoatForStaff(text, staff.id)
        after(async () => {
          await draftMaintenanceTask({
            slackEventId: `clock_${Date.now()}_${slackUserId}`,
            text: `[Gemeld door ${staff.name} tijdens ${action === 'in' ? 'check-in' : 'check-out'}]: ${text}`,
            reporter: staff.name || 'Captain',
            source: 'slack',
            boatId: boatResolution.boatId,
            boatName: boatResolution.boatName,
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
