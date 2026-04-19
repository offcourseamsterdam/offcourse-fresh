import { describe, it, expect, vi } from 'vitest'
import {
  generateImageMetadata,
  isCompleteMetadata,
  type ImageMetadata,
} from './generate-image-metadata'
import { LOCALES } from './context'

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64')

function mockFetch(): typeof fetch {
  const headers = new Headers({ 'content-type': 'image/png' })
  return vi.fn(async () =>
    new Response(PNG_BYTES, { status: 200, headers }),
  ) as unknown as typeof fetch
}

function mockGemini(response: string) {
  return {
    getGenerativeModel: vi.fn(() => ({
      generateContent: vi.fn(async () => ({
        response: { text: () => response },
      })),
    })),
  } as never
}

function mockClaude(response: string) {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text' as const, text: response }],
      })),
    },
  } as never
}

const VALID_GEMINI_JSON = JSON.stringify({
  en_alt: 'Diana electric boat gliding through a Jordaan canal at golden hour',
  en_caption: 'the light hits different from the water',
  primary_keywords: ['electric boat Amsterdam', 'Jordaan', 'golden hour canal'],
  confidence: 0.92,
})

const VALID_CLAUDE_JSON = JSON.stringify({
  alt_text: {
    nl: 'Diana elektrische boot door een Jordaan gracht in gouden uur',
    de: 'Diana Elektroboot in einer Jordaan-Gracht zur goldenen Stunde',
    fr: 'Bateau électrique Diana sur un canal du Jordaan à l\'heure dorée',
    es: 'Barco eléctrico Diana por un canal del Jordaan a la hora dorada',
    pt: 'Barco elétrico Diana num canal do Jordaan na hora dourada',
    zh: '黄金时分驶过约旦区运河的 Diana 电动船',
  },
  caption: {
    nl: 'het licht voelt anders vanaf het water',
    de: 'das Licht trifft vom Wasser aus anders',
    fr: 'la lumière frappe différemment depuis l\'eau',
    es: 'la luz se siente distinta desde el agua',
    pt: 'a luz bate diferente da água',
    zh: '水上的光线就是不一样',
  },
})

describe('generateImageMetadata', () => {
  it('returns alt_text + caption in all 7 locales', async () => {
    const result = await generateImageMetadata('https://example.com/photo.png', {
      fetchImpl: mockFetch(),
      gemini: mockGemini(VALID_GEMINI_JSON),
      claude: mockClaude(VALID_CLAUDE_JSON),
    })

    for (const loc of LOCALES) {
      expect(result.alt_text[loc]).toBeTruthy()
      expect(result.caption[loc]).toBeTruthy()
    }
  })

  it('uses Gemini output for English directly', async () => {
    const result = await generateImageMetadata('https://example.com/photo.png', {
      fetchImpl: mockFetch(),
      gemini: mockGemini(VALID_GEMINI_JSON),
      claude: mockClaude(VALID_CLAUDE_JSON),
    })

    expect(result.alt_text.en).toBe(
      'Diana electric boat gliding through a Jordaan canal at golden hour',
    )
    expect(result.caption.en).toBe('the light hits different from the water')
  })

  it('returns primary_keywords and confidence from Gemini', async () => {
    const result = await generateImageMetadata('https://example.com/photo.png', {
      fetchImpl: mockFetch(),
      gemini: mockGemini(VALID_GEMINI_JSON),
      claude: mockClaude(VALID_CLAUDE_JSON),
    })

    expect(result.primary_keywords).toContain('electric boat Amsterdam')
    expect(result.confidence).toBe(0.92)
  })

  it('strips markdown code fences from Gemini response', async () => {
    const fenced = '```json\n' + VALID_GEMINI_JSON + '\n```'
    const result = await generateImageMetadata('https://example.com/photo.png', {
      fetchImpl: mockFetch(),
      gemini: mockGemini(fenced),
      claude: mockClaude(VALID_CLAUDE_JSON),
    })
    expect(result.alt_text.en).toContain('Diana')
  })

  it('throws when image fetch fails', async () => {
    const failingFetch = vi.fn(async () =>
      new Response('', { status: 404, statusText: 'Not Found' }),
    ) as unknown as typeof fetch

    await expect(
      generateImageMetadata('https://example.com/missing.png', {
        fetchImpl: failingFetch,
        gemini: mockGemini(VALID_GEMINI_JSON),
        claude: mockClaude(VALID_CLAUDE_JSON),
      }),
    ).rejects.toThrow(/Failed to fetch image/)
  })

  it('throws when Gemini returns invalid JSON', async () => {
    await expect(
      generateImageMetadata('https://example.com/photo.png', {
        fetchImpl: mockFetch(),
        gemini: mockGemini('not json at all'),
        claude: mockClaude(VALID_CLAUDE_JSON),
      }),
    ).rejects.toThrow(/Invalid JSON from gemini/)
  })

  it('throws when Claude translation is missing a locale', async () => {
    const incomplete = JSON.stringify({
      alt_text: { nl: 'x', de: 'x', fr: 'x', es: 'x', pt: 'x' },
      caption: { nl: 'x', de: 'x', fr: 'x', es: 'x', pt: 'x', zh: 'x' },
    })
    await expect(
      generateImageMetadata('https://example.com/photo.png', {
        fetchImpl: mockFetch(),
        gemini: mockGemini(VALID_GEMINI_JSON),
        claude: mockClaude(incomplete),
      }),
    ).rejects.toThrow(/missing locale: zh/)
  })
})

describe('isCompleteMetadata', () => {
  const complete: ImageMetadata = {
    alt_text: { en: 'a', nl: 'a', de: 'a', fr: 'a', es: 'a', pt: 'a', zh: 'a' },
    caption: { en: 'b', nl: 'b', de: 'b', fr: 'b', es: 'b', pt: 'b', zh: 'b' },
    primary_keywords: [],
    confidence: 1,
  }

  it('returns true when all locales have text', () => {
    expect(isCompleteMetadata(complete)).toBe(true)
  })

  it('returns false when one alt_text locale is empty', () => {
    expect(
      isCompleteMetadata({
        ...complete,
        alt_text: { ...complete.alt_text, zh: '' },
      }),
    ).toBe(false)
  })

  it('returns false when one caption locale is whitespace-only', () => {
    expect(
      isCompleteMetadata({
        ...complete,
        caption: { ...complete.caption, de: '   ' },
      }),
    ).toBe(false)
  })
})
