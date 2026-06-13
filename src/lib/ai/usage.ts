import type Anthropic from '@anthropic-ai/sdk'
import { createAdminClient } from '@/lib/supabase/admin'
import { postToChannel } from '@/lib/slack/bot'
import { getClaude, CLAUDE_MODEL } from '@/lib/ai/clients'

/**
 * The Ghost's fuel gauge — every AI call records its tokens and cost here.
 *
 * Two jobs:
 *  1. recordAiUsage() after every Claude call (MANDATORY — see CLAUDE.md):
 *     tokens → euro cents → ai_usage row.
 *  2. Every €5 of cumulative spend → one Slack DM to Beer. The
 *     ai_usage_alerts table has the threshold as PRIMARY KEY, so even two
 *     concurrent calls crossing €5 produce exactly one alert (the second
 *     insert hits the PK conflict and stays silent).
 *
 * Best-effort by design: a metering failure must never break the feature
 * that made the AI call.
 */

// Claude Sonnet pricing (USD per million tokens) → EUR. Update when pricing
// or the FX picture changes meaningfully; this is a cost ESTIMATE for
// alerting, not bookkeeping.
const PRICING_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
}
const DEFAULT_PRICING = { input: 3, output: 15 }
const USD_TO_EUR = 0.92

const ALERT_STEP_EUR = 5
// Beer's Slack DM — override via env if the target ever changes.
const ALERT_SLACK_CHANNEL = process.env.AI_COST_ALERT_SLACK_ID ?? 'D08PRAXD13R'

export interface AiUsageInput {
  feature: string // 'ghost_reply_draft' | 'ghost_schedule_day' | 'ghost_catering_order' | 'chat_translate' | …
  model: string
  inputTokens: number
  outputTokens: number
}

/** Tokens → euro cents (numeric, fractions kept — single calls cost ~0.1¢). */
export function computeCostEurCents(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = PRICING_USD_PER_MTOK[model] ?? DEFAULT_PRICING
  const usd = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000
  return usd * USD_TO_EUR * 100
}

/** Which €5 thresholds does this spend increase newly cross? */
export function crossedThresholds(prevTotalCents: number, newTotalCents: number, stepEur = ALERT_STEP_EUR): number[] {
  const stepCents = stepEur * 100
  const prevStep = Math.floor(prevTotalCents / stepCents)
  const newStep = Math.floor(newTotalCents / stepCents)
  const out: number[] = []
  for (let s = prevStep + 1; s <= newStep; s++) out.push(s * stepEur)
  return out
}

/** Record one AI call. Never throws. */
export async function recordAiUsage({ feature, model, inputTokens, outputTokens }: AiUsageInput): Promise<void> {
  try {
    const supabase = createAdminClient()
    const costCents = computeCostEurCents(model, inputTokens, outputTokens)

    await supabase.from('ai_usage').insert({
      feature,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_eur_cents: costCents,
    })

    // Total spend → did we cross a €5 line?
    const { data: rows } = await supabase.from('ai_usage').select('cost_eur_cents')
    const totalCents = (rows ?? []).reduce((sum, r) => sum + Number(r.cost_eur_cents), 0)
    const thresholds = crossedThresholds(totalCents - costCents, totalCents)

    for (const threshold of thresholds) {
      // PK insert = atomically claim this threshold; conflict = someone else
      // already alerted it.
      const { error } = await supabase.from('ai_usage_alerts').insert({ threshold_eur: threshold })
      if (!error) {
        await postToChannel(
          ALERT_SLACK_CHANNEL,
          `🤖💶 AI spend just passed €${threshold} (total ≈ €${(totalCents / 100).toFixed(2)}). Latest: ${feature}. Check /admin/ghost for the breakdown.`,
        )
      }
    }
  } catch (err) {
    console.error('[ai-usage] metering failed:', err instanceof Error ? err.message : err)
  }
}

/**
 * Create a Claude message AND meter its token usage in one call, so the
 * mandatory metering (CLAUDE.md) can never be forgotten at a call site.
 * The agentic loop meters inline (it owns its own loop); every other Claude
 * call should go through here.
 */
export async function meteredMessage(
  feature: string,
  params: Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  const response = await getClaude().messages.create(params)
  await recordAiUsage({
    feature,
    model: typeof params.model === 'string' ? params.model : CLAUDE_MODEL,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  })
  return response
}

/** Spend summary for the Ghost page header. */
export async function getAiSpendSummary(): Promise<{ totalEur: number; last30dEur: number; calls: number }> {
  const supabase = createAdminClient()
  const { data: rows } = await supabase.from('ai_usage').select('cost_eur_cents, created_at')
  const all = rows ?? []
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const totalCents = all.reduce((s, r) => s + Number(r.cost_eur_cents), 0)
  const last30Cents = all
    .filter(r => new Date(r.created_at).getTime() >= cutoff)
    .reduce((s, r) => s + Number(r.cost_eur_cents), 0)
  return { totalEur: totalCents / 100, last30dEur: last30Cents / 100, calls: all.length }
}
