import { describe, it, expect } from 'vitest'
import { classifyAiReferrer, AI_REFERRER_HOSTS, AI_ENGINES, aggregateAiReferrals } from './ai-referrers'

describe('classifyAiReferrer', () => {
  it('identifies the major AI engines from real referrer URLs', () => {
    expect(classifyAiReferrer('https://chatgpt.com/')?.label).toBe('ChatGPT')
    expect(classifyAiReferrer('https://chat.openai.com/c/abc')?.label).toBe('ChatGPT')
    expect(classifyAiReferrer('https://www.perplexity.ai/search?q=amsterdam')?.label).toBe('Perplexity')
    expect(classifyAiReferrer('https://gemini.google.com/app')?.label).toBe('Gemini')
    expect(classifyAiReferrer('https://copilot.microsoft.com/')?.label).toBe('Copilot')
    expect(classifyAiReferrer('https://claude.ai/chat/x')?.label).toBe('Claude')
  })

  it('strips www and matches subdomains', () => {
    expect(classifyAiReferrer('https://www.you.com/')?.key).toBe('you')
    expect(classifyAiReferrer('https://sub.perplexity.ai/')?.key).toBe('perplexity')
  })

  it('returns null for normal search engines and socials (NOT AI)', () => {
    expect(classifyAiReferrer('https://www.google.com/')).toBeNull()
    expect(classifyAiReferrer('https://www.bing.com/')).toBeNull()
    expect(classifyAiReferrer('https://duckduckgo.com/')).toBeNull()
    expect(classifyAiReferrer('https://www.facebook.com/')).toBeNull()
    expect(classifyAiReferrer('https://thingstodoinamsterdam.com/')).toBeNull()
  })

  it('returns null for empty / malformed referrers', () => {
    expect(classifyAiReferrer(null)).toBeNull()
    expect(classifyAiReferrer(undefined)).toBeNull()
    expect(classifyAiReferrer('')).toBeNull()
    expect(classifyAiReferrer('not a url')).toBeNull()
  })

  it('AI_REFERRER_HOSTS covers every engine host (single source of truth)', () => {
    const fromEngines = AI_ENGINES.flatMap(e => e.hosts)
    expect(AI_REFERRER_HOSTS).toEqual(fromEngines)
    expect(AI_REFERRER_HOSTS).toContain('chatgpt.com')
    expect(AI_REFERRER_HOSTS.length).toBeGreaterThanOrEqual(11)
  })
})

describe('aggregateAiReferrals', () => {
  const sessions = [
    { id: 's1', visitor_id: 'v1', referrer: 'https://chatgpt.com/' },
    { id: 's2', visitor_id: 'v1', referrer: 'https://chatgpt.com/c/x' }, // same visitor, 2 sessions
    { id: 's3', visitor_id: 'v2', referrer: 'https://www.perplexity.ai/' },
    { id: 's4', visitor_id: 'anon_99', referrer: 'https://chatgpt.com/' }, // anon doesn't count as visitor
    { id: 's5', visitor_id: 'v3', referrer: 'https://www.google.com/' }, // not AI → ignored
  ]
  const bookings = [
    { session_id: 's1', stripe_amount: 16500 }, // booked in a ChatGPT session
    { session_id: 's3', stripe_amount: 9000 }, // booked in a Perplexity session
    { session_id: 's5', stripe_amount: 5000 }, // google session → not attributed to AI
    { session_id: null, stripe_amount: 4000 }, // direct → ignored
  ]

  it('groups sessions + unique visitors + bookings + revenue per engine', () => {
    const rows = aggregateAiReferrals(sessions, bookings)
    const chatgpt = rows.find(r => r.key === 'chatgpt')!
    const perplexity = rows.find(r => r.key === 'perplexity')!

    expect(chatgpt.sessions).toBe(3) // s1, s2, s4
    expect(chatgpt.visitors).toBe(1) // v1 only (anon excluded)
    expect(chatgpt.bookings).toBe(1)
    expect(chatgpt.revenueEuros).toBe(165)

    expect(perplexity.sessions).toBe(1)
    expect(perplexity.visitors).toBe(1)
    expect(perplexity.bookings).toBe(1)
    expect(perplexity.revenueEuros).toBe(90)
  })

  it('excludes non-AI sessions entirely', () => {
    const rows = aggregateAiReferrals(sessions, bookings)
    expect(rows.find(r => r.key === 'google')).toBeUndefined()
    expect(rows.every(r => r.key !== 'google')).toBe(true)
  })

  it('returns an empty array when there is no AI traffic', () => {
    expect(aggregateAiReferrals([{ id: 's1', visitor_id: 'v1', referrer: 'https://www.google.com/' }], [])).toEqual([])
  })

  it('sorts engines by session count, descending', () => {
    const rows = aggregateAiReferrals(sessions, bookings)
    expect(rows[0].key).toBe('chatgpt') // 3 sessions > perplexity's 1
  })
})
