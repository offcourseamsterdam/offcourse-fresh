import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ meteredMessage: vi.fn() }))
vi.mock('@/lib/utils', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, amsterdamToday: () => '2026-08-24' }
})

import { draftUpsellBonus } from './upsell-bonus-drafter'
import { createAdminClient } from '@/lib/supabase/admin'
import { meteredMessage } from '@/lib/ai/usage'

const BAS = { id: 'bas', name: 'Bas' }
const MARE = { id: 'mare', name: 'Mare' }

function makeSupabase(
  opts: { dedupe?: unknown[]; sender?: { id: string; name: string } | null; staff?: { id: string; name: string }[] } = {},
) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      contains: () => builder,
      limit: () => builder,
      maybeSingle: async () => ({ data: opts.sender ?? null, error: null }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        return Promise.resolve({ data: null, error: null })
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        let result: { data: unknown; error: null } = { data: null, error: null }
        if (table === 'agent_proposals') result = { data: opts.dedupe ?? [], error: null }
        else if (table === 'staff') result = { data: opts.staff ?? [BAS, MARE], error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return builder
  })
  return { client: { from }, from, inserts }
}

function claudeJson(obj: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('draftUpsellBonus', () => {
  it('skips (no AI call) when there is no text', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftUpsellBonus({ slackEventId: 'ev1', text: '   ', slackUserId: 'U1' })).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('skips (no AI call) when this Slack event was already drafted', async () => {
    const sb = makeSupabase({ dedupe: [{ id: 'prop1' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftUpsellBonus({ slackEventId: 'ev1', text: 'sold an extra 30 min for 20 euros', slackUserId: 'U1' })).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
  })

  it('skips when Claude decides the message is not an upsell report', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson({ is_upsell: false }) as never)

    expect(await draftUpsellBonus({ slackEventId: 'ev1', text: 'thanks for today!', slackUserId: 'U1' })).toBe('skipped')
    expect(sb.inserts).toHaveLength(0)
  })

  it('skips when Claude says it is an upsell but the numbers do not extract cleanly', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson({ is_upsell: true, extra_minutes: 0, amount_charged_eur: 20 }) as never)

    expect(await draftUpsellBonus({ slackEventId: 'ev1', text: 'sold some extra time', slackUserId: 'U1' })).toBe('skipped')
    expect(sb.inserts).toHaveLength(0)
  })

  it('drafts a shadow proposal with 50% commission, matching the sender by slack_member_id', async () => {
    const sb = makeSupabase({ sender: BAS })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({ is_upsell: true, extra_minutes: 30, amount_charged_eur: 20, captain_name: null, reasoning: 'Bas reported a 30 min upsell.' }) as never,
    )

    expect(await draftUpsellBonus({ slackEventId: 'ev1', text: 'sold an extra 30 min for 20 euros on the last tour', slackUserId: 'U-bas' })).toBe('drafted')

    expect(sb.inserts).toHaveLength(1)
    const { table, row } = sb.inserts[0]
    expect(table).toBe('agent_proposals')
    expect(row.kind).toBe('upsell_bonus')
    expect(row.status).toBe('shadow')
    expect(row.payload).toMatchObject({
      slack_event_id: 'ev1',
      staff_id: 'bas',
      staff_name: 'Bas',
      date: '2026-08-24',
      extra_minutes: 30,
      amount_charged_cents: 2000,
      commission_cents: 1000,
      raw_message: 'sold an extra 30 min for 20 euros on the last tour',
    })
  })

  it('falls back to matching a captain named in the message when the sender has no slack_member_id on file', async () => {
    const sb = makeSupabase({ sender: null, staff: [BAS, MARE] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({ is_upsell: true, extra_minutes: 60, amount_charged_eur: 30, captain_name: 'Mare', reasoning: 'ok' }) as never,
    )

    await draftUpsellBonus({ slackEventId: 'ev2', text: 'Mare sold an extra hour for 30 euros', slackUserId: 'U-unknown' })

    expect(sb.inserts[0].row.payload).toMatchObject({ staff_id: 'mare', staff_name: 'Mare' })
  })

  it('still drafts with a null staff_id when neither the sender nor a named captain can be matched — a human assigns it in the review UI', async () => {
    const sb = makeSupabase({ sender: null, staff: [BAS, MARE] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(
      claudeJson({ is_upsell: true, extra_minutes: 30, amount_charged_eur: 20, captain_name: null, reasoning: 'ok' }) as never,
    )

    expect(await draftUpsellBonus({ slackEventId: 'ev3', text: 'sold an extra 30 min for 20 euros', slackUserId: 'U-unknown' })).toBe('drafted')
    expect(sb.inserts[0].row.payload).toMatchObject({ staff_id: null, staff_name: null })
  })
})
