import { describe, it, expect, vi } from 'vitest'
import { recordOptOut, isOptedOut } from './reschedule-opt-outs'

function makeSupabase(rowsByColumn: { email?: string[]; phone?: string[] } = {}) {
  const inserted: Record<string, unknown>[] = []
  const from = vi.fn(() => ({
    select: () => ({
      eq: (col: 'email' | 'phone', val: string) => ({
        limit: async () => {
          const matches = (rowsByColumn[col] ?? []).includes(val)
          return { data: matches ? [{ id: 'match' }] : [] }
        },
      }),
    }),
    insert: (row: Record<string, unknown>) => {
      inserted.push(row)
      return Promise.resolve({ error: null })
    },
  }))
  return { client: { from } as never, inserted }
}

describe('recordOptOut', () => {
  it('inserts a row with both contact fields and the triggering booking/proposal', async () => {
    const { client, inserted } = makeSupabase()
    await recordOptOut(client, { email: 'a@b.com', phone: '+3161', bookingId: 'bk1', proposalId: 'p1' })
    expect(inserted).toEqual([{ email: 'a@b.com', phone: '+3161', booking_id: 'bk1', proposal_id: 'p1' }])
  })

  it('does nothing when there is no email or phone to key on', async () => {
    const { client, inserted } = makeSupabase()
    await recordOptOut(client, { email: null, phone: null, bookingId: 'bk1', proposalId: 'p1' })
    expect(inserted).toHaveLength(0)
  })
})

describe('isOptedOut', () => {
  it('true when the email matches a past decline', async () => {
    const { client } = makeSupabase({ email: ['a@b.com'] })
    expect(await isOptedOut(client, { email: 'a@b.com', phone: null })).toBe(true)
  })

  it('true when the phone matches, even if the email does not', async () => {
    const { client } = makeSupabase({ phone: ['+3161'] })
    expect(await isOptedOut(client, { email: 'nomatch@b.com', phone: '+3161' })).toBe(true)
  })

  it('false when neither matches', async () => {
    const { client } = makeSupabase({ email: ['other@b.com'] })
    expect(await isOptedOut(client, { email: 'a@b.com', phone: '+3161' })).toBe(false)
  })

  it('false when there is no contact info to check at all', async () => {
    const { client } = makeSupabase()
    expect(await isOptedOut(client, { email: null, phone: undefined })).toBe(false)
  })
})
