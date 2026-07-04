import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { awardReviewBonuses } from './review-bonuses'
import { createAdminClient } from '@/lib/supabase/admin'

function makeSupabase(opts: { staff?: { id: string; name: string }[] } = {}) {
  const upserts: { table: string; row: unknown }[] = []
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      upsert: (row: unknown, _opts?: unknown) => {
        upserts.push({ table, row })
        return { then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res) }
      },
      then: (res: (v: unknown) => unknown) => {
        const data = table === 'staff' ? (opts.staff ?? []) : []
        return Promise.resolve({ data, error: null }).then(res)
      },
    }
    return builder
  })
  return { client: { from }, upserts }
}

/** All upserts targeting the review_bonuses table. */
function bonusUpserts(upserts: { table: string; row: unknown }[]) {
  return upserts.filter(u => u.table === 'review_bonuses')
}
/** All upserts targeting the review_bonus_conflicts table. */
function conflictUpserts(upserts: { table: string; row: unknown }[]) {
  return upserts.filter(u => u.table === 'review_bonus_conflicts')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('awardReviewBonuses', () => {
  it('awards €5 bonus when first name appears in review text', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('review-1', 'Sophie was an amazing skipper!')
    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
    expect(bonusUpserts(sb.upserts)[0]).toMatchObject({
      row: { staff_id: 'staff-1', review_id: 'review-1', amount_cents: 500 },
    })
    expect(conflictUpserts(sb.upserts)).toHaveLength(0)
  })

  it('is case-insensitive', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Jannah' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'jannah was great')
    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
  })

  it('uses only the first name (not the full name)', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie de Vries' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'Sophie helped us so much')
    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
  })

  it('does not match a name that appears inside another word', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Jan' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'January was cold but the trip was great')
    expect(sb.upserts).toHaveLength(0)
  })

  it('skips names shorter than 3 characters', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Bo' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'Bo was fantastic')
    expect(sb.upserts).toHaveLength(0)
  })

  it('awards multiple bonuses when two different names both appear', async () => {
    const sb = makeSupabase({
      staff: [
        { id: 's1', name: 'Sophie' },
        { id: 's2', name: 'Tariq' },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'Sophie and Tariq were both wonderful')
    expect(bonusUpserts(sb.upserts)).toHaveLength(2)
    expect(conflictUpserts(sb.upserts)).toHaveLength(0)
  })

  it('does NOT auto-award a common-word name on ordinary prose — routes to conflict', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Will' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'We will definitely be back next summer — what a trip!')
    expect(bonusUpserts(sb.upserts)).toHaveLength(0)
    expect(conflictUpserts(sb.upserts)).toHaveLength(1)
    expect(conflictUpserts(sb.upserts)[0]).toMatchObject({
      row: { review_id: 'r1', matched_name: 'Will', candidate_staff_ids: ['s1'] },
    })
  })

  it('auto-awards a common-word name when a role word corroborates it', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Will' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'Will, our skipper, was fantastic')
    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
    expect(conflictUpserts(sb.upserts)).toHaveLength(0)
  })

  it('still auto-awards a clearly-attributed normal name ("Sophie our skipper")', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'Sophie our skipper made the afternoon')
    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
    expect(conflictUpserts(sb.upserts)).toHaveLength(0)
  })

  it('treats the drinks-word founder name "Beer" as ambiguous without a role word', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Beer' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'The beer was cold and the canals beautiful')
    expect(bonusUpserts(sb.upserts)).toHaveLength(0)
    expect(conflictUpserts(sb.upserts)).toHaveLength(1)
  })

  it('recognises a Dutch role word (schipper) for a common-word name', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Mark' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'Mark was een topper als schipper')
    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
    expect(conflictUpserts(sb.upserts)).toHaveLength(0)
  })

  it('creates a conflict instead of awarding when two staff share the same first name', async () => {
    const sb = makeSupabase({
      staff: [
        { id: 's1', name: 'Sophie de Vries' },
        { id: 's2', name: 'Sophie Bakker' },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'Sophie was an absolutely stellar skipper')
    expect(bonusUpserts(sb.upserts)).toHaveLength(0)
    expect(conflictUpserts(sb.upserts)).toHaveLength(1)
    expect(conflictUpserts(sb.upserts)[0]).toMatchObject({
      row: {
        review_id: 'r1',
        matched_name: 'Sophie',
        candidate_staff_ids: ['s1', 's2'],
      },
    })
  })

  it('does not award when no name matches', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'The boat was absolutely beautiful')
    expect(sb.upserts).toHaveLength(0)
  })

  it('does nothing when staff list is empty', async () => {
    const sb = makeSupabase({ staff: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('r1', 'Great trip with amazing crew!')
    expect(sb.upserts).toHaveLength(0)
  })

  it('swallows errors and never throws', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('DB down')
    })
    await expect(awardReviewBonuses('r1', 'Sophie was great')).resolves.toBeUndefined()
  })
})
