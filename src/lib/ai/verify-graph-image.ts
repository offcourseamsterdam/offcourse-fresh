import type { GoogleGenerativeAI } from '@google/generative-ai'
import { GEMINI_MODEL, getGemini } from './clients'

/**
 * Vision-verifies a candidate knowledge-graph image against the facts already
 * claimed about it, and surfaces anything else Gemini notices in the frame.
 *
 * Deliberately separate from generate-image-metadata.ts: that pipeline writes
 * SEO alt/caption copy for Off Course's OWN marketing photos (trusted source,
 * task is "describe it well"). This one checks an externally-sourced photo
 * (Wikimedia, stock) against a specific claim (task is "is this actually what
 * we think it is"), same job a human did by eye for the Homomonument photos —
 * this just makes that check repeatable instead of ad hoc.
 */

export type ImageVerification = {
  matches_claim: boolean
  match_confidence: number
  visible_description: string
  /**
   * Things Gemini noticed that aren't in the claimed facts — LEADS for the
   * graph, not verified facts. Never write these into kg_entities.facts
   * directly; they still need the same confirm-before-trust treatment as
   * anything from deep-research.
   */
  additional_observations: string[]
  quality_issues: string[]
}

const QUALITY_ISSUES = new Set([
  'blurry', 'too_dark', 'too_bright', 'low_resolution', 'bad_composition', 'watermarked',
])

export async function verifyGraphImage(args: {
  base64: string
  mimeType: string
  entityName: string
  claimedFacts: string
  gemini?: GoogleGenerativeAI
}): Promise<ImageVerification> {
  const gemini = args.gemini ?? getGemini()
  const model = gemini.getGenerativeModel({ model: GEMINI_MODEL })

  const prompt = [
    'TASK: You are fact-checking a candidate photo against claims in a knowledge graph, before it gets used on a blog and cited as fact.',
    '',
    `Entity: ${args.entityName}`,
    `Claimed facts this photo is supposed to show: ${args.claimedFacts}`,
    '',
    'Look at the actual image and answer honestly — do not assume the claim is true just because it was given to you.',
    '',
    'Produce:',
    '1. matches_claim — boolean. Does this photo actually, visibly show what is claimed? Be skeptical, not agreeable.',
    '2. match_confidence — 0.0 to 1.0.',
    '3. visible_description — plain description of what is ACTUALLY in the frame (do not reference the claim, just describe what you see).',
    '4. additional_observations — array of strings. Anything else notable and specific visible in the image that is NOT mentioned in the claimed facts (a detail, an object, a sign, a condition). Empty array if nothing new. These are leads for further research, not confirmed facts — phrase them as observations ("a rainbow flag is visible on..."), never as assertions of history or meaning.',
    '5. quality_issues — array from this exact list, empty if none apply: blurry, too_dark, too_bright, low_resolution, bad_composition, watermarked.',
    '',
    'Output ONLY JSON with keys: matches_claim, match_confidence, visible_description, additional_observations, quality_issues.',
  ].join('\n')

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { data: args.base64, mimeType: args.mimeType } },
  ])

  const text = result.response.text()
  const parsed = parseJson(text)
  parsed.quality_issues = Array.isArray(parsed.quality_issues)
    ? parsed.quality_issues.filter((q: string) => QUALITY_ISSUES.has(q))
    : []
  parsed.additional_observations = Array.isArray(parsed.additional_observations)
    ? parsed.additional_observations
    : []
  return parsed
}

function parseJson(raw: string): ImageVerification {
  let cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1)
  return JSON.parse(cleaned) as ImageVerification
}
