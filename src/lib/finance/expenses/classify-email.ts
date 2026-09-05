/**
 * What a finance-alias e-mail IS, read by Claude (plan §3.2 step 1): an order
 * confirmation, an "your invoice is ready" notification, a payment
 * confirmation, a mail carrying the invoice itself, or noise — plus whatever
 * identifying facts it states (supplier, order/invoice number, amount, date).
 *
 * Text, so Claude (CLAUDE.md's AI stack rule); the Haiku drafter model is
 * enough for a classification. Links are NOT left to the model — they're
 * pulled out deterministically (extractLinks) so a hallucinated URL can never
 * be fetched. Same "never invent" rule as every extractor here: a fact the
 * mail doesn't state comes back null.
 *
 * Pure parts (extractLinks, buildEmailPrompt, parseEmailClassification) are
 * fixture-tested; classifyFinanceEmail is the thin model call with an
 * injectable `callModel` for tests, mirroring cockpit/classify/ai.ts.
 */
import { CLAUDE_DRAFTER_MODEL, firstText, getClaude } from '@/lib/ai/clients'
import { recordAiUsage } from '@/lib/ai/usage'

export type FinanceEmailKind = 'order_confirmation' | 'invoice_notification' | 'payment_confirmation' | 'invoice_attached' | 'other'

export interface FinanceEmailClassification {
  kind: FinanceEmailKind
  supplierName: string | null
  orderNumber: string | null
  invoiceNumber: string | null
  /** YYYY-MM-DD */
  invoiceDate: string | null
  grossCents: number | null
  vatCents: number | null
  currency: string | null
  paymentReference: string | null
  /** The mail says the amount has already been paid/charged (card, iDEAL, "betaald"). */
  isPaidConfirmation: boolean
  confidence: number
  reason: string
}

export interface FinanceEmailInput {
  fromEmail: string
  fromName: string | null
  subject: string | null
  bodyText: string | null
  bodyHtml?: string | null
  hasPdfAttachment: boolean
  hasImageAttachment: boolean
  links: string[]
}

const KINDS = new Set<FinanceEmailKind>(['order_confirmation', 'invoice_notification', 'payment_confirmation', 'invoice_attached', 'other'])
const MAX_BODY_CHARS = 6000
const MAX_LINKS = 20

/**
 * Every http(s) URL in the text and in the HTML's href attributes, deduped,
 * trailing punctuation stripped, capped. mailto:/tel:/javascript: never appear.
 */
export function extractLinks(text: string | null | undefined, html?: string | null): string[] {
  const found = new Set<string>()
  const add = (raw: string) => {
    const cleaned = raw.replace(/[)\]>.,;:!?'"]+$/g, '')
    try {
      const u = new URL(cleaned)
      if (u.protocol === 'http:' || u.protocol === 'https:') found.add(u.toString())
    } catch { /* not a URL */ }
  }
  for (const m of (text ?? '').matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) add(m[0])
  for (const m of (html ?? '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) add(m[1])
  return [...found].slice(0, MAX_LINKS)
}

export function buildEmailPrompt(input: FinanceEmailInput): string {
  const body = (input.bodyText ?? '').slice(0, MAX_BODY_CHARS)
  return [
    'Je bent de boekhoudassistent van Off Course Amsterdam, een elektrische rondvaartonderneming. Een e-mail is binnengekomen op het financiële mailadres van het bedrijf. Bepaal wat dit is en haal de feiten eruit die er letterlijk in staan.',
    '',
    'SOORTEN:',
    '- order_confirmation: bevestiging van een bestelling/aankoop (nog geen factuur)',
    '- invoice_notification: melding dat een factuur klaarstaat / te downloaden is (factuur zelf niet bijgevoegd)',
    '- payment_confirmation: bevestiging dat een betaling is ontvangen of afgeschreven',
    '- invoice_attached: de factuur of bon zit als bijlage bij deze mail',
    '- other: nieuwsbrief, reclame, verzendupdate, of niet financieel relevant',
    '',
    'E-MAIL:',
    `- van: ${input.fromName ? `${input.fromName} <${input.fromEmail}>` : input.fromEmail}`,
    `- onderwerp: ${input.subject ?? '(geen)'}`,
    `- PDF-bijlage aanwezig: ${input.hasPdfAttachment ? 'ja' : 'nee'}`,
    `- afbeelding als bijlage: ${input.hasImageAttachment ? 'ja' : 'nee'}`,
    `- links in de mail: ${input.links.length ? input.links.slice(0, 10).join(' , ') : '(geen)'}`,
    '- tekst:',
    body || '(leeg)',
    '',
    'Antwoord met UITSLUITEND JSON, zonder toelichting eromheen:',
    '{"kind":"order_confirmation|invoice_notification|payment_confirmation|invoice_attached|other","supplier_name":null,"order_number":null,"invoice_number":null,"invoice_date":"YYYY-MM-DD of null","gross_cents":null,"vat_cents":null,"currency":"EUR of null","payment_reference":null,"is_paid_confirmation":false,"confidence":0.0,"reason":"één korte zin in het Nederlands"}',
    '',
    'Regels:',
    '- Bedragen in EUROCENTEN als geheel getal (€121,00 = 12100). Alleen invullen als het bedrag letterlijk in de mail staat — nooit schatten of optellen.',
    '- Een ordernummer of factuurnummer alleen invullen als het letterlijk genoemd wordt.',
    '- is_paid_confirmation is true als de mail zegt dat er al betaald/afgeschreven is (creditcard, iDEAL, "betaald", "payment received"). Een openstaande factuur is false.',
    '- confidence is je eigen zekerheid tussen 0 en 1. Twijfel je over de soort, kies "other" met een lage confidence.',
  ].join('\n')
}

/** Pulls the JSON object out of a model answer and normalises it. Null when unusable. */
export function parseEmailClassification(raw: string): FinanceEmailClassification | null {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return null
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    return null
  }
  const kind = typeof parsed.kind === 'string' && KINDS.has(parsed.kind as FinanceEmailKind) ? (parsed.kind as FinanceEmailKind) : null
  if (!kind) return null

  const str = (k: string): string | null => (typeof parsed[k] === 'string' && (parsed[k] as string).trim() ? (parsed[k] as string).trim() : null)
  const cents = (k: string): number | null => {
    const v = parsed[k]
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null
  }
  const confRaw = typeof parsed.confidence === 'number' ? parsed.confidence : Number(parsed.confidence)
  const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0
  const date = str('invoice_date')

  return {
    kind,
    supplierName: str('supplier_name'),
    orderNumber: str('order_number'),
    invoiceNumber: str('invoice_number'),
    invoiceDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    grossCents: cents('gross_cents'),
    vatCents: cents('vat_cents'),
    currency: str('currency')?.toUpperCase() ?? null,
    paymentReference: str('payment_reference'),
    isPaidConfirmation: parsed.is_paid_confirmation === true,
    confidence,
    reason: str('reason') ?? '',
  }
}

export interface ClassifyEmailOptions {
  /** Injected in tests. */
  callModel?: (prompt: string) => Promise<string>
}

export async function classifyFinanceEmail(input: FinanceEmailInput, opts: ClassifyEmailOptions = {}): Promise<FinanceEmailClassification | null> {
  const prompt = buildEmailPrompt(input)
  const callModel =
    opts.callModel ??
    (async (p: string) => {
      const claude = getClaude()
      const res = await claude.messages.create({ model: CLAUDE_DRAFTER_MODEL, max_tokens: 400, messages: [{ role: 'user', content: p }] })
      await recordAiUsage({ feature: 'finance_email_classify', model: CLAUDE_DRAFTER_MODEL, inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 })
      return firstText(res)
    })
  return parseEmailClassification(await callModel(prompt))
}
