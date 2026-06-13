import type Anthropic from '@anthropic-ai/sdk'
import { getClaude, CLAUDE_MODEL } from '@/lib/ai/clients'
import { recordAiUsage } from '@/lib/ai/usage'

/**
 * The agentic loop (Anthropic tool use) — what turns a text model into an
 * agent: a goal, a toolbox, and a loop.
 *
 *   1. Claude gets the goal + tool definitions
 *   2. It decides which tool to call (stop_reason 'tool_use')
 *   3. We EXECUTE the tool (read-only against the truth) and feed the
 *      result back as a tool_result block
 *   4. Repeat until it calls the terminal submit_* tool (its proposal)
 *      or hits MAX_TURNS
 *
 * Guardrails, because autonomy needs a leash:
 *   - every tool is read-only (the only "write" is the proposal itself,
 *     handled by the caller after the loop ends)
 *   - MAX_TURNS caps the loop; max_tokens caps each step
 *   - every API call is metered via recordAiUsage (the €5 Slack tripwire)
 *   - tool results are clamped so a fat query can't blow up the context
 *   - all errors surface as a clean null — agent failures never break
 *     the flow that triggered them
 */

export interface AgentTool {
  name: string
  description: string
  input_schema: Anthropic.Tool['input_schema']
  /** Read-only executor. Whatever it returns is JSON-stringified for Claude. */
  run: (input: Record<string, unknown>) => Promise<unknown>
}

export interface AgentStep {
  tool: string
  input: Record<string, unknown>
  /** Compact result preview shown on the Ghost page ("chain of actions"). */
  result_preview: string
}

export interface AgentRunResult {
  /** Input of the terminal submit_* tool call — the agent's proposal. */
  submission: Record<string, unknown>
  /** Which submit_* tool ended the run. */
  submittedVia: string
  /** Every tool call it made along the way, in order. */
  steps: AgentStep[]
  turns: number
}

const MAX_TURNS = 6
const MAX_TOOL_RESULT_CHARS = 4000

/** Clamp a tool result so one fat query can't flood the context window. */
export function clampToolResult(value: unknown, maxChars = MAX_TOOL_RESULT_CHARS): string {
  let json: string
  try {
    json = JSON.stringify(value)
  } catch {
    json = String(value)
  }
  if (json.length <= maxChars) return json
  return `${json.slice(0, maxChars)}…[truncated ${json.length - maxChars} chars — query narrower]`
}

/** First ~chars of a tool result for the step log. */
export function previewToolResult(value: unknown, maxChars = 280): string {
  const json = clampToolResult(value, maxChars + 100)
  return json.length > maxChars ? `${json.slice(0, maxChars)}…` : json
}

export async function runAgenticLoop(opts: {
  /** ai_usage feature tag, e.g. 'ghost_agent_inbox' */
  feature: string
  system: string
  /** The goal / task prompt. */
  prompt: string
  /** Read-only tools. */
  tools: AgentTool[]
  /** Terminal tools — calling one ends the run; their input IS the proposal. */
  submitTools: Omit<AgentTool, 'run'>[]
  maxTurns?: number
}): Promise<AgentRunResult | null> {
  const { feature, system, prompt, tools, submitTools } = opts
  const maxTurns = opts.maxTurns ?? MAX_TURNS

  const claude = getClaude()
  const toolMap = new Map(tools.map(t => [t.name, t]))
  const submitNames = new Set(submitTools.map(t => t.name))

  const apiTools: Anthropic.Tool[] = [
    ...tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    ...submitTools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
  ]

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }]
  const steps: AgentStep[] = []

  try {
    for (let turn = 1; turn <= maxTurns; turn++) {
      const lastTurn = turn === maxTurns
      const response = await claude.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1200,
        system,
        messages,
        tools: apiTools,
        // On the final turn, force a decision — no more browsing.
        tool_choice: lastTurn ? { type: 'any' } : { type: 'auto' },
      })

      await recordAiUsage({
        feature,
        model: CLAUDE_MODEL,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      })

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      )

      // A submit tool ends the run — its input is the proposal.
      const submission = toolUses.find(t => submitNames.has(t.name))
      if (submission) {
        return {
          submission: submission.input as Record<string, unknown>,
          submittedVia: submission.name,
          steps,
          turns: turn,
        }
      }

      if (!toolUses.length) {
        // Plain text without a submission: nudge once, then give up.
        if (response.stop_reason === 'end_turn' && turn < maxTurns) {
          messages.push(
            { role: 'assistant', content: response.content },
            { role: 'user', content: 'Finish by calling one of the submit tools with your proposal.' },
          )
          continue
        }
        return null
      }

      // Execute every requested read-only tool, feed results back.
      // Errors go back with is_error so the model adapts (per Anthropic
      // tool-use guidance) instead of trusting a broken result.
      messages.push({ role: 'assistant', content: response.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const use of toolUses) {
        const tool = toolMap.get(use.name)
        let resultText: string
        let isError = false
        if (!tool) {
          resultText = `Unknown tool '${use.name}'.`
          isError = true
        } else {
          try {
            const value = await tool.run(use.input as Record<string, unknown>)
            resultText = clampToolResult(value)
            steps.push({
              tool: use.name,
              input: use.input as Record<string, unknown>,
              result_preview: previewToolResult(value),
            })
          } catch (err) {
            resultText = `Tool error: ${err instanceof Error ? err.message : 'failed'}. Adjust your approach or work with what you have.`
            isError = true
            steps.push({
              tool: use.name,
              input: use.input as Record<string, unknown>,
              result_preview: resultText,
            })
          }
        }
        results.push({ type: 'tool_result', tool_use_id: use.id, content: resultText, is_error: isError })
      }
      messages.push({ role: 'user', content: results })
    }
    return null // ran out of turns without submitting
  } catch (err) {
    console.error(`[agent-runtime/${feature}] failed:`, err instanceof Error ? err.message : err)
    return null
  }
}
