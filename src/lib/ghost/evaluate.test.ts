import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))

import { scheduleAgreement, recentScheduleLessons } from './evaluate'

/**
 * The learning loop's math: an unapproved schedule draft is scored against
 * what the human actually assigned. These scores feed future drafts, so the
 * comparison itself must be dead-simple and exactly right.
 */
describe('scheduleAgreement', () => {
  const actual = new Map([
    ['sh1', { staff_id: 's-jip', staff_name: 'Jip' }],
    ['sh2', { staff_id: 's-janneke', staff_name: 'Janneke' }],
    ['sh3', { staff_id: null, staff_name: null }],
  ])

  it('scores full agreement', () => {
    const a = scheduleAgreement(
      [
        { shift_id: 'sh1', staff_id: 's-jip', staff_name: 'Jip' },
        { shift_id: 'sh2', staff_id: 's-janneke', staff_name: 'Janneke' },
      ],
      actual,
    )
    expect(a.matched).toBe(2)
    expect(a.total).toBe(2)
  })

  it('a different human choice is a mismatch that names both sides', () => {
    const a = scheduleAgreement([{ shift_id: 'sh2', staff_id: 's-jip', staff_name: 'Jip' }], actual)
    expect(a.matched).toBe(0)
    expect(a.details[0]).toEqual({
      shift_id: 'sh2',
      proposed_name: 'Jip',
      actual_name: 'Janneke',
      matched: false,
    })
  })

  it('a shift the human left open is a mismatch (actual: nobody)', () => {
    const a = scheduleAgreement([{ shift_id: 'sh3', staff_id: 's-jip', staff_name: 'Jip' }], actual)
    expect(a.matched).toBe(0)
    expect(a.details[0].actual_name).toBeNull()
  })

  it('assignments without a shift_id are ignored, deleted shifts count as unmatched', () => {
    const a = scheduleAgreement(
      [{ staff_id: 's-jip' }, { shift_id: 'gone', staff_id: 's-jip', staff_name: 'Jip' }],
      actual,
    )
    expect(a.total).toBe(1)
    expect(a.matched).toBe(0)
  })
})

describe('recentScheduleLessons', () => {
  function fakeSupabase(rows: unknown[]) {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      not: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: rows }),
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { from: () => builder } as any
  }

  it('renders mismatches as imitation lessons for the prompt', async () => {
    const block = await recentScheduleLessons(
      fakeSupabase([
        {
          payload: { target_date: '2026-07-03' },
          outcome: {
            agreement: {
              matched: 1,
              total: 2,
              details: [
                { shift_id: 'a', proposed_name: 'Jip', actual_name: 'Jip', matched: true },
                { shift_id: 'b', proposed_name: 'Jip', actual_name: 'Barry', matched: false },
              ],
            },
          },
        },
      ]),
    )
    expect(block).toContain('2026-07-03: 1/2 matched')
    expect(block).toContain('you proposed Jip, human chose Barry')
  })

  it('returns an empty string with no history — the prompt stays clean', async () => {
    expect(await recentScheduleLessons(fakeSupabase([]))).toBe('')
  })
})
