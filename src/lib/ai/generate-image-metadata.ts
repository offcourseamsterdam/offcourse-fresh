import type Anthropic from '@anthropic-ai/sdk'
import type { GoogleGenerativeAI } from '@google/generative-ai'
import { OFF_COURSE_SYSTEM_PROMPT, LOCALES, type Locale } from './context'
import { flattenKeywords } from './seo-keywords'
import { CLAUDE_MODEL, GEMINI_MODEL, getClaude, getGemini } from './clients'
import { buildSeoFilename } from '../images/seo-filename'

export type QualityIssue = 'blurry' | 'too_dark' | 'too_bright' | 'low_resolution' | 'bad_composition' | 'watermarked'

export type ImageMetadata = {
  alt_text: Record<Locale, string>
  caption: Record<Locale, string>
  primary_keywords: string[]
  confidence: number
  /** SEO-friendly base filename derived from primary_keywords (no extension/suffix). */
  seo_filename: string
  /** Quality flags from Gemini — empty array when image is fine. */
  quality_issues: QualityIssue[]
}

export type GenerateOptions = {
  context?: string
  keywords?: string[]
  fetchImpl?: typeof fetch
  claude?: Anthropic
  gemini?: GoogleGenerativeAI
}

type GeminiResult = {
  en_alt: string
  en_caption: string
  primary_keywords: string[]
  confidence: number
  quality_issues: QualityIssue[]
}

const VALID_QUALITY_ISSUES: ReadonlySet<QualityIssue> = new Set([
  'blurry',
  'too_dark',
  'too_bright',
  'low_resolution',
  'bad_composition',
  'watermarked',
])

type TranslationLocale = Exclude<Locale, 'en'>
type ClaudeTranslations = {
  alt_text: Record<TranslationLocale, string>
  caption: Record<TranslationLocale, string>
}

const TRANSLATION_LOCALES: TranslationLocale[] = ['nl', 'de', 'fr', 'es', 'pt', 'zh']

export async function generateImageMetadata(
  imageUrl: string,
  opts: GenerateOptions = {},
): Promise<ImageMetadata> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const { base64, mimeType } = await fetchImageAsBase64(imageUrl, fetchImpl)
  return generateImageMetadataFromBase64(base64, mimeType, opts)
}

/**
 * Same as generateImageMetadata but accepts a pre-fetched buffer directly.
 * Preferred in the processing pipeline since Sharp already has the data in memory —
 * avoids a second HTTP download and ensures a small, consistent image size for Gemini.
 */
export async function generateImageMetadataFromBuffer(
  buffer: Buffer,
  mimeType: string,
  opts: GenerateOptions = {},
): Promise<ImageMetadata> {
  const base64 = buffer.toString('base64')
  return generateImageMetadataFromBase64(base64, mimeType, opts)
}

async function generateImageMetadataFromBase64(
  base64: string,
  mimeType: string,
  opts: GenerateOptions = {},
): Promise<ImageMetadata> {
  const claude = opts.claude ?? getClaude()
  const gemini = opts.gemini ?? getGemini()
  const keywords = opts.keywords ?? flattenKeywords()

  const visionResult = await describeWithGemini({
    gemini,
    base64,
    mimeType,
    keywords,
    context: opts.context,
  })

  const translations = await translateWithClaude({
    claude,
    altEn: visionResult.en_alt,
    captionEn: visionResult.en_caption,
  })

  return {
    alt_text: { en: visionResult.en_alt, ...translations.alt_text },
    caption: { en: visionResult.en_caption, ...translations.caption },
    primary_keywords: visionResult.primary_keywords,
    confidence: visionResult.confidence,
    seo_filename: buildSeoFilename(visionResult.primary_keywords),
    quality_issues: visionResult.quality_issues,
  }
}

async function fetchImageAsBase64(
  url: string,
  fetchImpl: typeof fetch,
): Promise<{ base64: string; mimeType: string }> {
  const res = await fetchImpl(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText}`)
  }
  const mimeType = res.headers.get('content-type') ?? 'image/jpeg'
  const buf = Buffer.from(await res.arrayBuffer())
  return { base64: buf.toString('base64'), mimeType }
}

async function describeWithGemini(args: {
  gemini: GoogleGenerativeAI
  base64: string
  mimeType: string
  keywords: string[]
  context?: string
}): Promise<GeminiResult> {
  const model = args.gemini.getGenerativeModel({ model: GEMINI_MODEL })

  const prompt = [
    OFF_COURSE_SYSTEM_PROMPT,
    '',
    'TASK: Look at this image and describe it for Off Course Amsterdam\'s website.',
    '',
    'Produce:',
    '1. en_alt — a descriptive alt-text in English, 8-16 words, for SEO + screen readers. Describe what IS in the image (scene, people, boat, canal, lighting). Work in 1-2 relevant keywords ONLY if they truthfully describe the image.',
    '2. en_caption — a short caption, 5-10 words, in Off Course\'s voice (warm, slightly poetic, never corporate).',
    '3. primary_keywords — array of 2-5 keywords from the provided list that this image TRULY depicts. Do not invent, do not stuff.',
    '4. confidence — 0.0 to 1.0, how confident you are that the description is accurate.',
    '5. quality_issues — array of flags ONLY if the image has real problems. Empty array if fine. Allowed values:',
    '   - "blurry": noticeable motion blur or out-of-focus subject',
    '   - "too_dark": underexposed, hard to make out subject',
    '   - "too_bright": overexposed, blown highlights',
    '   - "low_resolution": pixelated or visibly compressed',
    '   - "bad_composition": subject cut off, awkward framing, distracting clutter',
    '   - "watermarked": stock-photo watermark or visible logo overlay',
    '',
    `Keyword pool: ${args.keywords.join(', ')}`,
    args.context ? `Context hint: ${args.context}` : '',
    '',
    'Output ONLY JSON with keys: en_alt, en_caption, primary_keywords, confidence, quality_issues.',
  ]
    .filter(Boolean)
    .join('\n')

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { data: args.base64, mimeType: args.mimeType } },
  ])

  const text = result.response.text()
  const parsed = parseJsonStrict<GeminiResult>(text, 'gemini')
  // Defensive: filter to only allowed quality_issue values
  parsed.quality_issues = Array.isArray(parsed.quality_issues)
    ? parsed.quality_issues.filter((q): q is QualityIssue => VALID_QUALITY_ISSUES.has(q as QualityIssue))
    : []
  return parsed
}

async function translateWithClaude(args: {
  claude: Anthropic
  altEn: string
  captionEn: string
}): Promise<ClaudeTranslations> {
  const userPrompt = [
    'Translate the two English strings below into these 6 locales: nl, de, fr, es, pt, zh.',
    '',
    'Follow every hard rule in the system prompt (do not translate "Off Course", "Diana", "Curaçao"; use local skipper equivalents; no corporate language).',
    'Alt-text stays descriptive and factual in every language. Caption keeps the Off Course voice.',
    '',
    `en_alt: "${args.altEn}"`,
    `en_caption: "${args.captionEn}"`,
    '',
    'Return ONLY valid JSON with this exact shape:',
    '{',
    '  "alt_text": { "nl": "...", "de": "...", "fr": "...", "es": "...", "pt": "...", "zh": "..." },',
    '  "caption":  { "nl": "...", "de": "...", "fr": "...", "es": "...", "pt": "...", "zh": "..." }',
    '}',
  ].join('\n')

  const message = await args.claude.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    system: OFF_COURSE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = message.content[0]?.type === 'text' ? message.content[0].text : ''
  const parsed = parseJsonStrict<ClaudeTranslations>(text, 'claude')

  for (const loc of TRANSLATION_LOCALES) {
    if (!parsed.alt_text?.[loc] || !parsed.caption?.[loc]) {
      throw new Error(`Claude translation missing locale: ${loc}`)
    }
  }
  return parsed
}

function parseJsonStrict<T>(raw: string, source: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  try {
    return JSON.parse(cleaned) as T
  } catch (err) {
    throw new Error(
      `Invalid JSON from ${source}: ${err instanceof Error ? err.message : 'parse error'}`,
    )
  }
}

export function isCompleteMetadata(m: ImageMetadata): boolean {
  return LOCALES.every(
    loc => Boolean(m.alt_text[loc]?.trim()) && Boolean(m.caption[loc]?.trim()),
  )
}
