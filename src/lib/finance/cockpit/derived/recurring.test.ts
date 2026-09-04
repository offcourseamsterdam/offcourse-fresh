import { describe, it, expect } from 'vitest'
import { clusterByDayOfMonth, detectInterval, detectRecurring, proposalToObligation, type RecurringInput } from './recurring'

// Dates and amounts below are the real ones from the Revolut feed synced on
// 2026-09-04, so the detector is judged on what actually arrives.

const TODAY = '2026-09-04'
const row = (label: string, date: string, euros: number, extra: Partial<RecurringInput> = {}): RecurringInput => ({
  id: `${label}-${date}`, label, date, amountCents: Math.round(euros * 100), ...extra,
})

describe('detectInterval', () => {
  it('recognises a monthly rhythm even when the day shifts a little', () => {
    expect(detectInterval([{ date: '2026-06-21' }, { date: '2026-07-21' }, { date: '2026-08-21' }])).toBe(1)
    expect(detectInterval([{ date: '2026-06-19' }, { date: '2026-07-21' }, { date: '2026-08-21' }])).toBe(1)
  })
  it('recognises quarterly and yearly', () => {
    expect(detectInterval([{ date: '2026-01-15' }, { date: '2026-04-15' }, { date: '2026-07-15' }])).toBe(3)
    expect(detectInterval([{ date: '2024-03-01' }, { date: '2025-03-01' }, { date: '2026-03-02' }])).toBe(12)
  })
  it('refuses to invent a rhythm from irregular dates', () => {
    expect(detectInterval([{ date: '2026-06-20' }, { date: '2026-06-24' }, { date: '2026-07-11' }])).toBeNull()
    expect(detectInterval([{ date: '2026-06-01' }])).toBeNull()
  })
})

describe('clusterByDayOfMonth', () => {
  it('splits one vendor billing on two days into two series (the real Supabase case)', () => {
    const events = [
      { date: '2026-06-08', amountCents: 3000 }, { date: '2026-06-12', amountCents: 2100 },
      { date: '2026-07-08', amountCents: 3000 }, { date: '2026-07-12', amountCents: 2900 },
      { date: '2026-08-08', amountCents: 3000 }, { date: '2026-08-12', amountCents: 3100 },
    ]
    const clusters = clusterByDayOfMonth(events)
    expect(clusters).toHaveLength(2)
    expect(clusters.map(c => c.length)).toEqual([3, 3])
    expect(clusters.every(c => detectInterval(c) === 1)).toBe(true)
  })

  it('treats the 30th and the 1st as the same billing day', () => {
    expect(clusterByDayOfMonth([
      { date: '2026-05-30', amountCents: 100 },
      { date: '2026-07-01', amountCents: 100 },
    ])).toHaveLength(1)
  })
})

describe('detectRecurring — the real feed', () => {
  const feed: RecurringInput[] = [
    // Exactly monthly, exactly the same amount.
    row('Lovable', '2026-06-21', 5), row('Lovable', '2026-07-21', 5), row('Lovable', '2026-08-21', 5),
    // Monthly, amount creeping up.
    row('Snelstart Software', '2026-06-19', 61), row('Snelstart Software', '2026-07-21', 63), row('Snelstart Software', '2026-08-21', 64),
    // Revolut's own subscription.
    row('Company Free plan fee', '2026-06-28', 10), row('Company Free plan fee', '2026-07-28', 10), row('Company Free plan fee', '2026-08-28', 10),
    // Groceries: frequent but arrhythmic, must not be proposed.
    row('Marqt', '2026-06-20', 4), row('Marqt', '2026-06-24', 8), row('Marqt', '2026-06-27', 2),
    row('Marqt', '2026-07-05', 6), row('Marqt', '2026-07-08', 4), row('Marqt', '2026-07-10', 13),
    // Two payments on one day: a single event, not a daily charge.
    row('To Jachthaven westerdok marina', '2026-08-17', 3226), row('To Jachthaven westerdok marina', '2026-08-17', 1210),
  ]

  it('proposes the steady subscriptions and leaves the groceries alone', () => {
    const proposals = detectRecurring(feed, { today: TODAY })
    const labels = proposals.map(p => p.label)
    expect(labels).toContain('Lovable')
    expect(labels).toContain('Snelstart Software')
    expect(labels).toContain('Company Free plan fee')
    expect(labels).not.toContain('Marqt')
    expect(labels).not.toContain('To Jachthaven westerdok marina')
  })

  it('budgets the most recent amount and predicts the next charge', () => {
    const snelstart = detectRecurring(feed, { today: TODAY }).find(p => p.label === 'Snelstart Software')!
    expect(snelstart).toMatchObject({ intervalMonths: 1, amountCents: 6400, occurrences: 3, lastSeen: '2026-08-21', nextExpected: '2026-09-21' })
    expect(snelstart.minAmountCents).toBe(6100)
    expect(snelstart.maxAmountCents).toBe(6400)
  })

  it('says plainly when an amount is steady and when it moves', () => {
    const proposals = detectRecurring(feed, { today: TODAY })
    expect(proposals.find(p => p.label === 'Lovable')!.amountVaries).toBe(false)
    expect(proposals.find(p => p.label === 'Lovable')!.confidence).toBeGreaterThan(0.7)
    // 61 → 64 is a 5% spread, still steady enough to call fixed.
    expect(proposals.find(p => p.label === 'Snelstart Software')!.amountVaries).toBe(false)
  })

  it('needs more than a coincidence before proposing anything', () => {
    const twice = [row('E.O.C. Onderl. Schepenverz. U.A.', '2026-06-15', 562), row('E.O.C. Onderl. Schepenverz. U.A.', '2026-07-15', 562)]
    expect(detectRecurring(twice, { today: TODAY })).toEqual([])
    expect(detectRecurring(twice, { today: TODAY, minOccurrences: 2 })).toHaveLength(1)
  })

  it('never proposes something that already has an obligation', () => {
    const proposals = detectRecurring(feed, { today: TODAY, existingLabels: ['lovable'] })
    expect(proposals.map(p => p.label)).not.toContain('Lovable')
  })

  it('ignores charges too small to plan around', () => {
    const tiny = [row('Klein', '2026-06-01', 1), row('Klein', '2026-07-01', 1), row('Klein', '2026-08-01', 1)]
    expect(detectRecurring(tiny, { today: TODAY })).toEqual([])
  })

  it('carries the classification along so a confirmed proposal lands in the right category', () => {
    const withCategory = [
      row('E.O.C.', '2026-03-15', 562, { category: 'operating', subcategory: 'insurance' }),
      row('E.O.C.', '2026-06-15', 562), row('E.O.C.', '2026-09-15', 562),
    ]
    const [p] = detectRecurring(withCategory, { today: TODAY })
    expect(p).toMatchObject({ intervalMonths: 3, category: 'operating', subcategory: 'insurance' })
  })

  it('puts the most consequential proposal first', () => {
    const proposals = detectRecurring(feed, { today: TODAY })
    expect(proposals[0].label).toBe('Snelstart Software')
  })
})

describe('proposalToObligation', () => {
  it('writes a note that says where the number came from', () => {
    const [p] = detectRecurring(
      [row('Lovable', '2026-06-21', 5), row('Lovable', '2026-07-21', 5), row('Lovable', '2026-08-21', 5)],
      { today: TODAY },
    )
    const o = proposalToObligation(p, 'contract')
    expect(o).toMatchObject({ title: 'Lovable', kind: 'contract', amount_cents: 500, recurrence_months: 1, due_date: '2026-09-21' })
    expect(o.notes).toContain('3 afschrijvingen')
    expect(o.notes).toContain('€5,00')
  })

  it('warns in the note when the amount is not fixed', () => {
    const [p] = detectRecurring(
      [row('Wisselend', '2026-06-10', 100), row('Wisselend', '2026-07-10', 400), row('Wisselend', '2026-08-10', 250)],
      { today: TODAY },
    )
    expect(proposalToObligation(p, 'contract').notes).toContain('wisselt')
  })
})
