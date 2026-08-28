import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
const h = vi.hoisted(() => ({ postDm: vi.fn().mockResolvedValue(true) }))
vi.mock('@/lib/slack/bot', () => ({ postDm: h.postDm }))

import { awardReviewBonuses, extractMentionedNames, isFuzzyNameMatch, sendReviewBonusDm, scanReviewsForBonuses } from './review-bonuses'
import { createAdminClient } from '@/lib/supabase/admin'

function makeSupabase(opts: {
  staff?: { id: string; name: string }[]
  freshInsert?: boolean
  /** slack_member_id/slack_notifications_enabled per staff id, for sendReviewBonusDm's lookup. */
  slackInfo?: Record<string, { slack_member_id: string | null; slack_notifications_enabled: boolean }>
} = {}) {
  const upserts: { table: string; row: unknown }[] = []
  const updates: { table: string; patch: unknown }[] = []
  const freshInsert = opts.freshInsert ?? true
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (_col: string, val: string) => ({
        ...builder,
        single: async () => ({ data: table === 'staff' ? (opts.slackInfo?.[val] ?? null) : null, error: null }),
      }),
      update: (patch: unknown) => ({
        eq: async () => {
          updates.push({ table, patch })
          return { error: null }
        },
      }),
      upsert: (row: unknown, _opts?: unknown) => {
        upserts.push({ table, row })
        // review-bonuses.ts calls .select() after the review_bonuses upsert
        // specifically to tell a fresh insert apart from an ignoreDuplicates
        // no-op (see its own comment) — freshInsert:false simulates a re-scan
        // of an already-processed review, where .select() would return [].
        return {
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
          select: () => ({
            then: (res: (v: unknown) => unknown) => Promise.resolve({ data: freshInsert ? [row] : [], error: null }).then(res),
          }),
        }
      },
      then: (res: (v: unknown) => unknown) => {
        const data = table === 'staff' ? (opts.staff ?? []) : []
        return Promise.resolve({ data, error: null }).then(res)
      },
    }
    return builder
  })
  return { client: { from }, upserts, updates }
}

/** All upserts targeting the review_bonuses table. */
function bonusUpserts(upserts: { table: string; row: unknown }[]) {
  return upserts.filter(u => u.table === 'review_bonuses')
}
/** All upserts targeting the review_bonus_conflicts table. */
function conflictUpserts(upserts: { table: string; row: unknown }[]) {
  return upserts.filter(u => u.table === 'review_bonus_conflicts')
}

/** A fake Claude client whose extraction call resolves to the given names, injected via awardReviewBonuses's DI option — no module mocking needed. */
function fakeClaude(names: string[]) {
  const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(names) }] })
  return { client: { messages: { create } } as never, create }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('isFuzzyNameMatch', () => {
  it('matches a one-letter typo on a short name', () => {
    expect(isFuzzyNameMatch('josh', 'josj')).toBe(true) // 1 edit, threshold 1 for <=5 chars
  })

  it('does not match a two-letter difference on a short name', () => {
    expect(isFuzzyNameMatch('josh', 'jose')).toBe(true) // 1 substitution — still within threshold
    expect(isFuzzyNameMatch('josh', 'joye')).toBe(false) // 2 substitutions — over threshold for a 4-letter name
  })

  it('allows up to 2 edits on a longer name', () => {
    expect(isFuzzyNameMatch('joshua', 'joshy')).toBe(true) // 2 edits (drop 'ua', add 'y') within a 6-char name
  })

  it('never treats an identical pair as a fuzzy match — that is the exact-match path, not this one', () => {
    expect(isFuzzyNameMatch('sophie', 'sophie')).toBe(false)
  })

  it('rejects two names that are simply unrelated', () => {
    expect(isFuzzyNameMatch('sophie', 'tariq')).toBe(false)
  })
})

describe('extractMentionedNames', () => {
  it('parses a valid JSON array of names', async () => {
    const { client } = fakeClaude(['Joshua', 'Sophie'])
    await expect(extractMentionedNames('Joshua and Sophie were great', { claude: client })).resolves.toEqual(['Joshua', 'Sophie'])
  })

  it('returns an empty array when Claude finds no names', async () => {
    const { client } = fakeClaude([])
    await expect(extractMentionedNames('Beautiful boat, lovely afternoon', { claude: client })).resolves.toEqual([])
  })

  it('drops a non-string or too-short entry rather than trusting a malformed response', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(['Joshua', 42, 'Bo', 'X', '']) }] })
    const client = { messages: { create } } as never
    // 'Bo' (2 chars) is a real short name and is kept; 'X' (1 char) and '' are
    // dropped by MIN_NAME_LENGTH; 42 is dropped for not being a string.
    await expect(extractMentionedNames('x', { claude: client })).resolves.toEqual(['Joshua', 'Bo'])
  })

  it('returns an empty array rather than throwing when the response is not valid JSON', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'not json at all' }] })
    const client = { messages: { create } } as never
    await expect(extractMentionedNames('x', { claude: client })).resolves.toEqual([])
  })

  it('returns an empty array when the parsed JSON is not an array', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: '{"name":"Joshua"}' }] })
    const client = { messages: { create } } as never
    await expect(extractMentionedNames('x', { claude: client })).resolves.toEqual([])
  })
})

describe('awardReviewBonuses — 5-star gate (Beer, 2026-08-22: "5 stars only, 4 stars we dont")', () => {
  it('awards nothing for a 4-star review naming a skipper — the exact live bug this fixes', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client, create } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was an amazing skipper!', 4, { claude: client })

    expect(sb.upserts).toHaveLength(0)
    expect(create).not.toHaveBeenCalled() // never even calls Claude below the gate
  })

  it('never queries staff for a sub-5-star review either — the gate short-circuits before any DB or AI call', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('review-1', 'Sophie was an amazing skipper!', 3)

    expect(sb.client.from).not.toHaveBeenCalled()
  })

  it('still awards normally at exactly 5 stars', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was an amazing skipper!', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
  })

  it('never stamps an explicit awarded_at — the bonus lands in whichever month it was FOUND, via the DB\'s own now() default, never the review\'s publish_time (Beer, 2026-08-22)', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was an amazing skipper!', 5, { claude: client })

    const row = bonusUpserts(sb.upserts)[0]!.row as Record<string, unknown>
    expect(row).not.toHaveProperty('awarded_at')
  })
})

describe('awardReviewBonuses — matching (name mentioned is enough, no role-word requirement — Beer, 2026-08-22)', () => {
  it('awards €5 when Claude extracts a name matching exactly one active staff member', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie helped us so much', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toEqual([
      { table: 'review_bonuses', row: { staff_id: 'staff-1', review_id: 'review-1', amount_cents: 500 } },
    ])
    expect(conflictUpserts(sb.upserts)).toHaveLength(0)
  })

  it('awards a staff member named "Beer" when Claude extracts it as a real mention — the old role-word guard is gone, a name is enough', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-founder', name: 'Beer' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Beer']) // Claude judged this a real mention of the host, not the drink

    await awardReviewBonuses('review-1', 'Our host Beer was fantastic', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
  })

  it('never fires on "we had a beer" or "we will be back" — Claude (not a regex) is what decides these are not names, so nothing reaches the matcher at all', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-founder', name: 'Beer' }, { id: 'staff-w', name: 'Will' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude([]) // Claude correctly extracts no names from ordinary prose

    await awardReviewBonuses('review-1', 'We had a beer and will definitely be back next summer', 5, { claude: client })

    expect(sb.upserts).toHaveLength(0)
  })

  it('awards each person once when two names are mentioned in one review (Beer, 2026-08-22: "€5 each")', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie' }, { id: 's2', name: 'Tariq' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie', 'Tariq'])

    await awardReviewBonuses('review-1', 'Sophie and Tariq were both wonderful', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toHaveLength(2)
    expect(bonusUpserts(sb.upserts).map(u => (u.row as { staff_id: string }).staff_id).sort()).toEqual(['s1', 's2'])
  })

  it('is case-insensitive against the staff roster', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Jannah' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['jannah'])

    await awardReviewBonuses('review-1', 'jannah was great', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
  })

  it('matches on first name only, from a full-name staff record', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Bo Jansen' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Bo'])

    await awardReviewBonuses('review-1', 'Bo was fantastic', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
  })

  it('raises a conflict (no award) when two active staff share the exact extracted name', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie de Vries' }, { id: 's2', name: 'Sophie Bakker' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie our skipper made the afternoon', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toHaveLength(0)
    expect(conflictUpserts(sb.upserts)).toEqual([
      { table: 'review_bonus_conflicts', row: { review_id: 'review-1', matched_name: 'Sophie', candidate_staff_ids: ['s1', 's2'] } },
    ])
  })

  it('does nothing when the extracted name matches no active staff member at all (e.g. the reviewer\'s own name)', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sarah']) // the reviewer's own name, not a staff mention

    await awardReviewBonuses('review-1', 'Sarah (that\'s me!) had a lovely time', 5, { claude: client })

    expect(sb.upserts).toHaveLength(0)
  })

  it('never calls Claude when there is no active staff at all — nothing to match against', async () => {
    const sb = makeSupabase({ staff: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { create } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was great', 5)

    expect(create).not.toHaveBeenCalled()
  })

  it('deduplicates the same mentioned name (case-insensitively) into a single award attempt', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie', 'sophie'])

    await awardReviewBonuses('review-1', 'Sophie, our lovely Sophie', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toHaveLength(1)
  })
})

describe('awardReviewBonuses — near-miss fuzzy match: "assign it AND flag it" (Beer, 2026-08-22)', () => {
  it('awards the bonus immediately AND raises a conflict with awarded_staff_id already set, for a single near-miss candidate', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-josh', name: 'Joshua' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Joshy']) // no exact match, but close to "Joshua"

    await awardReviewBonuses('review-1', 'Joshy was a great guide', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toEqual([
      { table: 'review_bonuses', row: { staff_id: 'staff-josh', review_id: 'review-1', amount_cents: 500 } },
    ])
    expect(conflictUpserts(sb.upserts)).toEqual([
      { table: 'review_bonus_conflicts', row: { review_id: 'review-1', matched_name: 'Joshua', candidate_staff_ids: ['staff-josh'], awarded_staff_id: 'staff-josh' } },
    ])
  })

  it('raises a conflict with NO award when the near-miss is ambiguous between two staff', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sem' }, { id: 's2', name: 'Sam' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sim']) // one edit from both "Sem" and "Sam"

    await awardReviewBonuses('review-1', 'Sim was great', 5, { claude: client })

    expect(bonusUpserts(sb.upserts)).toHaveLength(0)
    const conflicts = conflictUpserts(sb.upserts)
    expect(conflicts).toHaveLength(1)
    expect((conflicts[0]!.row as { awarded_staff_id?: string }).awarded_staff_id).toBeUndefined()
    expect((conflicts[0]!.row as { candidate_staff_ids: string[] }).candidate_staff_ids.sort()).toEqual(['s1', 's2'])
  })

  it('does nothing for a name with no exact AND no fuzzy match to any staff', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Zachary'])

    await awardReviewBonuses('review-1', 'Zachary was our guide', 5, { claude: client })

    expect(sb.upserts).toHaveLength(0)
  })
})

describe('awardReviewBonuses — Slack DM on an unambiguous exact match (Beer, 2026-08-22: fires immediately, nothing to hold it for)', () => {
  it('DMs the skipper immediately when the exact match is fresh (a genuinely new bonus)', async () => {
    const sb = makeSupabase({
      staff: [{ id: 'staff-1', name: 'Sophie' }],
      slackInfo: { 'staff-1': { slack_member_id: 'U123', slack_notifications_enabled: true } },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was an amazing skipper!', 5, { claude: client })

    expect(h.postDm).toHaveBeenCalledTimes(1)
    expect(h.postDm).toHaveBeenCalledWith('U123', expect.stringContaining('€5'), expect.anything())
  })

  it('does NOT re-DM on a re-scan of an already-processed review — the upsert no-ops, .select() returns empty, no fresh insert to DM about', async () => {
    const sb = makeSupabase({
      staff: [{ id: 'staff-1', name: 'Sophie' }],
      freshInsert: false, // simulates: this (staff, review) pair already exists
      slackInfo: { 'staff-1': { slack_member_id: 'U123', slack_notifications_enabled: true } },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was an amazing skipper!', 5, { claude: client })

    expect(h.postDm).not.toHaveBeenCalled()
  })

  it('does not DM a staff member with no slack_member_id configured', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }], slackInfo: { 'staff-1': { slack_member_id: null, slack_notifications_enabled: true } } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was great', 5, { claude: client })

    expect(h.postDm).not.toHaveBeenCalled()
  })

  it('does not DM a staff member who has opted out (slack_notifications_enabled: false)', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }], slackInfo: { 'staff-1': { slack_member_id: 'U123', slack_notifications_enabled: false } } })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was great', 5, { claude: client })

    expect(h.postDm).not.toHaveBeenCalled()
  })

  it('does NOT DM on a near-miss fuzzy award — that one is held until a human confirms via the conflicts route, not sent from here', async () => {
    const sb = makeSupabase({
      staff: [{ id: 'staff-josh', name: 'Joshua' }],
      slackInfo: { 'staff-josh': { slack_member_id: 'U999', slack_notifications_enabled: true } },
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Joshy'])

    await awardReviewBonuses('review-1', 'Joshy was a great guide', 5, { claude: client })

    expect(h.postDm).not.toHaveBeenCalled()
  })
})

describe('sendReviewBonusDm', () => {
  it('includes the star rating and review text in the message', async () => {
    const sb = makeSupabase({ slackInfo: { 'staff-1': { slack_member_id: 'U123', slack_notifications_enabled: true } } })
    await sendReviewBonusDm(sb.client as never, 'staff-1', 5, 'Sophie was amazing')
    expect(h.postDm).toHaveBeenCalledWith('U123', expect.stringContaining('⭐⭐⭐⭐⭐'), expect.anything())
    expect(h.postDm).toHaveBeenCalledWith('U123', expect.stringContaining('Sophie was amazing'), expect.anything())
  })

  it('does nothing when the staff record is not found', async () => {
    const sb = makeSupabase({})
    await sendReviewBonusDm(sb.client as never, 'unknown-staff', 5, 'text')
    expect(h.postDm).not.toHaveBeenCalled()
  })
})

describe('awardReviewBonuses — never breaks the caller', () => {
  it('swallows an error and resolves with an empty result rather than throwing (e.g. the AI call fails)', async () => {
    const sb = makeSupabase({ staff: [{ id: 's1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('anthropic down')) } } as never

    await expect(awardReviewBonuses('review-1', 'Sophie was great', 5, { claude: client })).resolves.toEqual({ unmatchedNames: [] })
  })
})

describe('awardReviewBonuses — bonus_checked_at (Beer, 2026-08-22: "pre assign with AI" backfill needs to know what\'s already been scanned)', () => {
  it('stamps bonus_checked_at on the review after a successful scan', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    await awardReviewBonuses('review-1', 'Sophie was great', 5, { claude: client })

    const stamped = sb.updates.filter(u => u.table === 'social_proof_reviews')
    expect(stamped).toHaveLength(1)
    expect(stamped[0]!.patch).toHaveProperty('bonus_checked_at')
  })

  it('does not stamp bonus_checked_at for a sub-5-star review — a backfill only ever queries rating=5 in the first place', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    await awardReviewBonuses('review-1', 'Sophie was great', 4)

    expect(sb.updates.filter(u => u.table === 'social_proof_reviews')).toHaveLength(0)
  })

  it('does not stamp bonus_checked_at when the AI call fails — an unscanned review should be retried, not marked done', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const client = { messages: { create: vi.fn().mockRejectedValue(new Error('anthropic down')) } } as never

    await awardReviewBonuses('review-1', 'Sophie was great', 5, { claude: client })

    expect(sb.updates.filter(u => u.table === 'social_proof_reviews')).toHaveLength(0)
  })
})

describe('awardReviewBonuses — unmatchedNames (Beer, 2026-08-22: "if you are missing captains, tell me which")', () => {
  it('reports a mentioned name that matches no active staff member at all, exact or fuzzy', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Marco'])

    const result = await awardReviewBonuses('review-1', 'Marco was our guide', 5, { claude: client })

    expect(result.unmatchedNames).toEqual(['Marco'])
  })

  it('does not report a name that matched exactly, via fuzzy match, or via a shared-name conflict', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }, { id: 'staff-2', name: 'Sophie de Boer' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Sophie'])

    const result = await awardReviewBonuses('review-1', 'Sophie was great', 5, { claude: client })

    expect(result.unmatchedNames).toEqual([])
  })

  it('reports each distinct unmatched name only once even if mentioned twice', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Marco', 'marco'])

    const result = await awardReviewBonuses('review-1', 'Marco, our lovely Marco', 5, { claude: client })

    expect(result.unmatchedNames).toEqual(['Marco'])
  })

  it('is empty for a sub-5-star review — the gate short-circuits before any matching happens', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const result = await awardReviewBonuses('review-1', 'Marco was our guide', 4)

    expect(result.unmatchedNames).toEqual([])
  })
})

describe('scanReviewsForBonuses — shared multi-row scan (simplify pass, 2026-08-23: fixes a real N+1 found while scanning 153 backfill rows one-by-one)', () => {
  it('fetches the staff roster exactly once regardless of how many rows are scanned', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude([])

    await scanReviewsForBonuses(
      [
        { id: 'r1', reviewText: 'Nice trip', rating: 5 },
        { id: 'r2', reviewText: 'Lovely afternoon', rating: 5 },
        { id: 'r3', reviewText: 'Great time', rating: 5 },
      ],
      { claude: client },
    )

    expect(sb.client.from.mock.calls.filter(([table]: [string]) => table === 'staff')).toHaveLength(1)
  })

  it('scans every row and returns each row\'s unmatched names keyed by id', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude(['Marco'])

    const results = await scanReviewsForBonuses(
      [{ id: 'r1', reviewText: 'Marco was our guide', rating: 5 }],
      { claude: client },
    )

    expect(results).toEqual([{ id: 'r1', unmatchedNames: ['Marco'] }])
  })

  it('joins reviewText and originalText before scanning', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client, create } = fakeClaude([])

    await scanReviewsForBonuses([{ id: 'r1', reviewText: 'Nice trip.', originalText: 'Great tour!', rating: 5 }], { claude: client })

    expect(create.mock.calls[0][0].messages[0].content).toBe('Nice trip. Great tour!')
  })

  it('skips a row with no text at all rather than calling the matcher on an empty string', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client, create } = fakeClaude([])

    const results = await scanReviewsForBonuses([{ id: 'r1', reviewText: null, originalText: null, rating: 5 }], { claude: client })

    expect(create).not.toHaveBeenCalled()
    expect(results).toEqual([{ id: 'r1', unmatchedNames: [] }])
  })

  it('processes more rows than the concurrency batch size and still returns a result for every row, in order', async () => {
    const sb = makeSupabase({ staff: [{ id: 'staff-1', name: 'Sophie' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    const { client } = fakeClaude([])

    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, reviewText: `Review number ${i}`, rating: 5 }))
    const results = await scanReviewsForBonuses(rows, { claude: client })

    expect(results.map(r => r.id)).toEqual(rows.map(r => r.id))
  })
})
