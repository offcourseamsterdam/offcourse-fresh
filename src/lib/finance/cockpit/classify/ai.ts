import 'server-only'

/**
 * The AI layer, for transactions the deterministic rules could not place.
 *
 * Deliberately narrow: Claude only picks a category and subcategory from the
 * fixed taxonomy and may suggest a boat. It never links a loan payment, an
 * obligation or a goal, because those are financial commitments that need
 * evidence rather than a guess (see rules.ts).
 *
 * The prompt carries the last corrections Beer made, so the model drifts
 * towards his own vocabulary instead of a generic bookkeeping default.
 */

import { CLAUDE_DRAFTER_MODEL, firstText, getClaude } from '@/lib/ai/clients'
import { CATEGORIES, directionAllows, isCategory, isSubcategory, type Category } from './taxonomy'
import type { ClassifiableTransaction, Classification } from './rules'

export interface AiCorrectionExample {
  label: string
  amountCents: number
  category: string
  subcategory: string | null
}

export interface AiClassifyOptions {
  boats?: Array<{ id: string; name: string }>
  recentCorrections?: AiCorrectionExample[]
  /** Injected in tests. */
  callModel?: (prompt: string) => Promise<string>
}

function taxonomyForPrompt(): string {
  return Object.entries(CATEGORIES)
    .map(([key, def]) => {
      const subs = Object.entries(def.subcategories).map(([sk, sl]) => `${sk} (${sl})`).join(', ')
      return `- ${key} — ${def.label}: ${subs}`
    })
    .join('\n')
}

export function buildPrompt(tx: ClassifiableTransaction, opts: AiClassifyOptions): string {
  const direction = tx.amountCents < 0 ? 'UITGAAND (geld eraf)' : 'INKOMEND (geld erbij)'
  const euro = (Math.abs(tx.amountCents) / 100).toFixed(2)
  const corrections = (opts.recentCorrections ?? []).slice(0, 20)
  const boats = opts.boats ?? []

  return [
    'Je bent de boekhoudassistent van Off Course Amsterdam, een elektrische rondvaartonderneming.',
    'Classificeer één banktransactie in exact één categorie en subcategorie uit de lijst.',
    '',
    'CATEGORIEËN:',
    taxonomyForPrompt(),
    '',
    boats.length > 0 ? `BOTEN (alleen invullen als de transactie duidelijk aan één boot toehoort): ${boats.map(b => `${b.name} = ${b.id}`).join(', ')}` : '',
    corrections.length > 0
      ? ['', 'EERDERE CORRECTIES VAN DE EIGENAAR (volg deze stijl):',
         ...corrections.map(c => `- "${c.label}" (€${(Math.abs(c.amountCents) / 100).toFixed(2)}) → ${c.category}/${c.subcategory ?? '-'}`)].join('\n')
      : '',
    '',
    'TRANSACTIE:',
    `- richting: ${direction}`,
    `- bedrag: €${euro}`,
    `- type volgens de bank: ${tx.type}`,
    `- tegenpartij: ${tx.counterpartyName ?? '(onbekend)'}`,
    `- winkelier: ${tx.merchantName ?? '(onbekend)'}`,
    `- omschrijving: ${tx.description ?? '(leeg)'}`,
    `- referentie: ${tx.reference ?? '(leeg)'}`,
    tx.merchantCategoryCode ? `- MCC: ${tx.merchantCategoryCode}` : '',
    '',
    'Antwoord met UITSLUITEND JSON, zonder toelichting eromheen:',
    '{"category":"...","subcategory":"...","boat_id":null,"confidence":0.0,"reason":"één korte zin in het Nederlands"}',
    '',
    'Regels:',
    '- Een UITGAANDE transactie mag nooit "income" zijn; een INKOMENDE nooit "operating", "maintenance", "upgrade", "investment" of "tax".',
    '- confidence is je eigen zekerheid tussen 0 en 1. Twijfel je, geef dan een lage waarde; een lage score laat een mens meekijken en dat is prima.',
    '- Verzin niets: als de omschrijving nietszeggend is, kies de "other"-subcategorie met een lage confidence.',
  ].filter(Boolean).join('\n')
}

/** Pulls the JSON object out of a model answer, tolerating stray prose or fences. */
export function parseAiAnswer(raw: string): { category: string; subcategory: string | null; boat_id: string | null; confidence: number; reason: string } | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    const category = typeof parsed.category === 'string' ? parsed.category : null
    if (!category) return null
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence)
    return {
      category,
      subcategory: typeof parsed.subcategory === 'string' && parsed.subcategory !== '-' ? parsed.subcategory : null,
      boat_id: typeof parsed.boat_id === 'string' && parsed.boat_id.length > 10 ? parsed.boat_id : null,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 300) : '',
    }
  } catch {
    return null
  }
}

/**
 * Validates a model answer against the taxonomy and the sign of the amount.
 * A category that contradicts the direction is rejected outright rather than
 * stored with low confidence: a misfiled sign corrupts every total downstream.
 */
export function validateAiAnswer(
  answer: ReturnType<typeof parseAiAnswer>,
  tx: ClassifiableTransaction,
  boats: Array<{ id: string; name: string }>,
): Classification | null {
  if (!answer) return null
  if (!isCategory(answer.category)) return null
  const category = answer.category as Category
  if (!directionAllows(category, tx.amountCents)) return null
  const subcategory = answer.subcategory && isSubcategory(category, answer.subcategory) ? answer.subcategory : null
  const boatId = answer.boat_id && boats.some(b => b.id === answer.boat_id) ? answer.boat_id : null
  return {
    category,
    subcategory,
    boatId,
    confidence: answer.confidence,
    reason: answer.reason || 'Door de AI geclassificeerd',
    source: 'ai',
  }
}

export async function classifyWithAi(tx: ClassifiableTransaction, opts: AiClassifyOptions = {}): Promise<Classification | null> {
  const prompt = buildPrompt(tx, opts)
  const call = opts.callModel ?? defaultCall
  let raw: string
  try {
    raw = await call(prompt)
  } catch (err) {
    console.error('[classify/ai] model call failed:', (err as Error).message)
    return null
  }
  return validateAiAnswer(parseAiAnswer(raw), tx, opts.boats ?? [])
}

async function defaultCall(prompt: string): Promise<string> {
  const claude = getClaude()
  const res = await claude.messages.create({
    model: CLAUDE_DRAFTER_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  })
  return firstText(res)
}
