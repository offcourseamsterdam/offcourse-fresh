import { CLAUDE_DRAFTER_MODEL, firstText } from '@/lib/ai/clients'
import { meteredMessage } from '@/lib/ai/usage'
import type { SimilarityLabel } from './similarity'

/**
 * The on-demand learning signal: ask Claude WHAT the human changed between the
 * Ghost's draft and the reply they actually sent — the concrete lesson. The
 * cheap always-on badge lives in similarity.ts; this is the explanation.
 */

export interface DifferenceAnalysis {
  verdict: SimilarityLabel
  summary: string
}

/** Metered. Returns null on failure (best-effort). */
export async function analyzeDifference(
  customerMessage: string,
  draft: string,
  actual: string,
): Promise<DifferenceAnalysis | null> {
  try {
    const response = await meteredMessage('ghost_compare', {
      model: CLAUDE_DRAFTER_MODEL,
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `An AI drafted a customer-support reply; a human then sent their own. Compare them and state, in ONE short sentence, what the human changed and the lesson the AI should take from it (tone, facts, length, an offer they added/removed). If they're essentially the same, say so.

CUSTOMER: ${customerMessage}

AI DRAFT: ${draft}

HUMAN SENT: ${actual}

Return JSON only: {"verdict": "match" | "minor" | "different", "summary": "<one sentence>"}`,
        },
      ],
    })
    const raw = firstText(response).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const obj = JSON.parse(raw) as { verdict?: string; summary?: string }
    const verdict: SimilarityLabel =
      obj.verdict === 'match' || obj.verdict === 'minor' || obj.verdict === 'different' ? obj.verdict : 'minor'
    if (typeof obj.summary !== 'string' || !obj.summary.trim()) return null
    return { verdict, summary: obj.summary.trim() }
  } catch {
    return null
  }
}
