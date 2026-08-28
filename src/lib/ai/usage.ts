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
  // Gemini 2.5 Flash — vision (photo descriptions). Estimate for the spend
  // alert, not bookkeeping; update if Google's pricing moves.
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
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

    // Total spend → did we cross a €5 line? Summed in SQL (ai_usage_total_cents,
    // 126_inbox_ghost_perf.sql) instead of pulling every row over the wire on
    // every single AI call — ai_usage only grows.
    const { data: totalCentsRaw } = await supabase.rpc('ai_usage_total_cents')
    const totalCents = Number(totalCentsRaw ?? 0)
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

/** All-time spend for one feature tag (one Ghost agent / AI surface). */
export interface FeatureSpend {
  feature: string
  totalEur: number
  calls: number
}

export interface AiSpendSummary {
  totalEur: number
  last30dEur: number
  calls: number
  /** Per-feature breakdown, highest spend first. Turns the single total into a
   *  steerable line item — you can see which agent actually costs money. */
  byFeature: FeatureSpend[]
}

interface AiSpendSummaryRpcRow {
  totalCents?: number | string | null
  last30dCents?: number | string | null
  calls?: number | null
  byFeature?: { feature: string; totalCents: number | string; calls: number }[] | null
}

/**
 * Spend summary for the Ghost page header + the per-agent breakdown. Computed
 * server-side by ai_spend_summary() (126_inbox_ghost_perf.sql) instead of
 * pulling every ai_usage row over the wire and reducing in JS — this runs on
 * every 15s poll of /admin/ghost, and ai_usage only grows.
 */
export async function getAiSpendSummary(): Promise<AiSpendSummary> {
  const supabase = createAdminClient()
  const { data } = await supabase.rpc('ai_spend_summary')
  const summary = (data ?? {}) as AiSpendSummaryRpcRow

  return {
    totalEur: Number(summary.totalCents ?? 0) / 100,
    last30dEur: Number(summary.last30dCents ?? 0) / 100,
    calls: summary.calls ?? 0,
    byFeature: (summary.byFeature ?? []).map(f => ({
      feature: f.feature,
      totalEur: Number(f.totalCents) / 100,
      calls: f.calls,
    })),
  }
}
