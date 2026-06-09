import { describe, it, expect } from 'vitest'
import { aggregateWhatsAppClicks } from './queries'

describe('aggregateWhatsAppClicks', () => {
  it('returns zero for no rows', () => {
    expect(aggregateWhatsAppClicks([])).toEqual({ total: 0, bySource: [], googleAdsSessions: 0 })
  })

  it('counts unique sessions overall (deduping repeat rows from one session)', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'floating_button' } },
      { session_id: 's1', metadata: { source: 'floating_button' } },
      { session_id: 's2', metadata: { source: 'floating_button' } },
    ])
    expect(stats.total).toBe(2)
    expect(stats.bySource).toEqual([{ source: 'floating_button', sessions: 2 }])
  })

  it('breaks down unique sessions per source, sorted by sessions desc', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'floating_button' } },
      { session_id: 's2', metadata: { source: 'floating_button' } },
      { session_id: 's3', metadata: { source: 'floating_button' } },
      { session_id: 's1', metadata: { source: 'footer' } },
      { session_id: 's2', metadata: { source: 'footer' } },
      { session_id: 's1', metadata: { source: 'chat_to_book' } },
    ])
    expect(stats.bySource).toEqual([
      { source: 'floating_button', sessions: 3 },
      { source: 'footer', sessions: 2 },
      { source: 'chat_to_book', sessions: 1 },
    ])
  })

  it('counts a session once in the total even if it used multiple sources', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'floating_button' } },
      { session_id: 's1', metadata: { source: 'footer' } },
    ])
    expect(stats.total).toBe(1)
    expect(stats.bySource).toHaveLength(2)
  })

  it('buckets missing/empty source under "unknown"', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: null },
      { session_id: 's2', metadata: {} },
    ])
    expect(stats.total).toBe(2)
    expect(stats.bySource).toEqual([{ source: 'unknown', sessions: 2 }])
  })

  it('ignores rows with no session_id', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: '', metadata: { source: 'footer' } },
    ])
    expect(stats).toEqual({ total: 0, bySource: [], googleAdsSessions: 0 })
  })

  it('counts unique Google Ads sessions (gclid present), deduped per session', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'floating_button', gclid: 'abc123' } },
      { session_id: 's1', metadata: { source: 'footer', gclid: 'abc123' } }, // same session, still 1
      { session_id: 's2', metadata: { source: 'floating_button', gclid: 'def456' } },
      { session_id: 's3', metadata: { source: 'floating_button' } }, // no gclid → not an ad clicker
    ])
    expect(stats.total).toBe(3)
    expect(stats.googleAdsSessions).toBe(2)
  })

  it('does not count empty-string gclid as a Google Ads session', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'footer', gclid: '' } },
    ])
    expect(stats.googleAdsSessions).toBe(0)
  })
})
