import { CLAUDE_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import { createAdminClient } from '@/lib/supabase/admin'
import { extractJson } from '@/lib/ghost/ops-drafters'
import { commissionCentsFor } from '@/lib/scheduling/extra-hours-bonus'
import { amsterdamToday } from '@/lib/utils'

/**
 * The upsell-bonus agent — shadow mode (Beer, 2026-08-24: "captains message
 * the slack bot; upsell of their cruise with x and then in the payroll tab
 * we have an upsell review environment where we can check that upsell and
 * assign it properly... inbetween slack and the upsell tab there should be
 * an ai reading the incoming information").
 *
 * Fires on a Slack DM to the bot. It:
 *   1. classifies whether the message is even reporting an upsell (most DMs
 *      to a bot that only does this ARE, but a stray "thanks!" shouldn't
 *      become a €0 proposal)
 *   2. extracts extra_minutes and amount_charged_cents from free text
 *   3. best-effort matches the sender's Slack user id to a staff row —
 *      real captains mostly have no slack_member_id on file yet (2026-08-24),
 *      so this frequently comes back unmatched; the review UI lets a human
 *      pick the right captain regardless, same as it lets them correct any
 *      other field the model got wrong.
 * Writes ONE `agent_proposals` row (kind 'upsell_bonus', status 'shadow') —
 * never creates the real extra_hours_bonuses row itself. That only happens
 * when a human confirms it via POST /api/admin/ghost/proposals/[id]
 * {action: 'confirm_upsell_bonus'} — money always needs a human click.
 *
 * Same hard rules as the other drafters: status 'shadow', nothing executes,
 * every AI call metered, skip-first, all errors swallowed (never breaks the
 * Slack webhook).
 */

export interface UpsellDmInput {
  /** Slack event id — dedupe key (one proposal per event). */
  slackEventId: string
  text: string
  /** The sender's Slack user id, used to best-effort match a staff row. */
  slackUserId: string
}

export async function draftUpsellBonus(input: UpsellDmInput): Promise<'drafted' | 'skipped'> {
  try {
    const text = (input.text ?? '').trim()
    if (!text || !input.slackEventId) return 'skipped'

    const supabase = createAdminClient()

    // Dedupe per Slack event — a retried delivery shouldn't draft twice.
    const { data: existing } = await supabase
      .from('agent_proposals')
      .select('id')
      .eq('kind', 'upsell_bonus')
      .contains('payload', { slack_event_id: input.slackEventId })
      .limit(1)
    if (existing?.length) return 'skipped'

    // Best-effort sender match — see the file doc comment on why this often misses.
    const { data: sender } = await supabase
      .from('staff')
      .select('id, name')
      .eq('slack_member_id', input.slackUserId)
      .eq('is_active', true)
      .maybeSingle()

    const { data: staff } = await supabase.from('staff').select('id, name').eq('is_active', true)
    const staffNames = (staff ?? []).map(s => s.name).join(', ')

    const response = await meteredMessage('ghost_upsell_bonus', {
      model: CLAUDE_MODEL,
      max_tokens: 400,
      messages: [
        {
          role: 'user',
          content: `You are the shadow upsell-bonus assistant for Off Course Amsterdam (electric canal boats). A captain DM'd the Slack bot; this is a SHADOW proposal — nothing is paid out, a human reviews it in the Payroll tab.

Captains: ${staffNames || '(none on file)'}${sender ? `\nThis message came from: ${sender.name}` : ''}

Decide if this message is reporting an on-the-water upsell (selling guests extra time on their cruise) — captains sometimes DM this bot about other things too. If it is NOT an upsell report, return {"is_upsell": false}.

If it IS an upsell report, extract:
- extra_minutes: how many extra minutes were sold (a captain might say "half an hour" = 30, "an hour" = 60, etc.)
- amount_charged_eur: how many euros the guests were charged for it (a whole number or with cents)
- captain_name: if the message names who did the upsell and it's not obvious from the sender, one of the captains listed above, else null

MESSAGE:
${text}

Return JSON only:
{"is_upsell": true, "extra_minutes": <number>, "amount_charged_eur": <number>, "captain_name": "<one of the captains above, or null>", "reasoning": "<1 sentence>"}
or
{"is_upsell": false}`,
        },
      ],
    })

    const parsed = extractJson(firstText(response))
    if (!parsed || parsed.is_upsell !== true) return 'skipped'

    const extraMinutes = typeof parsed.extra_minutes === 'number' && parsed.extra_minutes > 0 ? Math.round(parsed.extra_minutes) : null
    const amountChargedCents =
      typeof parsed.amount_charged_eur === 'number' && parsed.amount_charged_eur > 0 ? Math.round(parsed.amount_charged_eur * 100) : null
    if (!extraMinutes || !amountChargedCents) return 'skipped' // couldn't extract real numbers — not worth a blank proposal

    // Prefer the Slack-identity match; fall back to a name Claude found in the text.
    const namedCaptain = (staff ?? []).find(s => s.name.toLowerCase() === String(parsed.captain_name ?? '').toLowerCase())
    const matched = sender ?? namedCaptain ?? null

    await supabase.from('agent_proposals').insert({
      kind: 'upsell_bonus',
      status: 'shadow',
      model: CLAUDE_MODEL,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : null,
      payload: {
        slack_event_id: input.slackEventId,
        staff_id: matched?.id ?? null,
        staff_name: matched?.name ?? null,
        date: amsterdamToday(),
        extra_minutes: extraMinutes,
        amount_charged_cents: amountChargedCents,
        commission_cents: commissionCentsFor(amountChargedCents),
        raw_message: text,
      },
    })

    return 'drafted'
  } catch (err) {
    console.error('[ghost/upsell_bonus] failed:', err instanceof Error ? err.message : err)
    return 'skipped'
  }
}
