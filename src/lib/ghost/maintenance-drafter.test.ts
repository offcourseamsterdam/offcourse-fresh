import { describe, it, expect, vi, beforeEach } from 'vitest'

// vitest hoists vi.mock above the imports.
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ meteredMessage: vi.fn() }))
vi.mock('@/lib/ai/describe-image', () => ({ describeImageWithGemini: vi.fn() }))

import { draftMaintenanceTask } from './maintenance-drafter'
import { createAdminClient } from '@/lib/supabase/admin'
import { meteredMessage } from '@/lib/ai/usage'
import { describeImageWithGemini } from '@/lib/ai/describe-image'

/**
 * Supabase stub for the maintenance drafter. Reads (dedupe, boats) and the
 * proposal-link update resolve via `then`; inserts are captured AND return a
 * chainable builder so `.insert().select().single()` works. `taskId: null`
 * simulates a unique-index conflict (concurrent delivery).
 */
function makeSupabase(opts: {
  dedupe?: unknown[]
  boats?: Array<{ id: string; name: string }>
  taskId?: string | null
  proposalId?: string | null
} = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const updates: Array<{ table: string; row: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      _insertResult: undefined as unknown,
      _insertError: null as unknown,
      select: () => builder,
      eq: () => builder,
      limit: () => builder,
      single: async () => ({ data: builder._insertResult ?? null, error: builder._insertError ?? null }),
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        if (table === 'maintenance_tasks') {
          builder._insertResult = opts.taskId === null ? null : { id: opts.taskId ?? 'task1' }
          builder._insertError = opts.taskId === null ? { message: 'duplicate key' } : null
        } else if (table === 'agent_proposals') {
          builder._insertResult = opts.proposalId === null ? null : { id: opts.proposalId ?? 'prop1' }
        }
        return builder
      },
      update: (row: Record<string, unknown>) => {
        updates.push({ table, row })
        return builder
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        let result: { data: unknown; error: null } = { data: null, error: null }
        if (table === 'maintenance_tasks') result = { data: opts.dedupe ?? [], error: null }
        else if (table === 'boats') result = { data: opts.boats ?? [], error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return builder
  })
  return { client: { from }, from, inserts, updates }
}

function claudeJson(obj: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

const HAPPY = {
  priority: 'essential',
  title: 'Cracked seat cushion',
  summary: 'The port-side bench cushion on Diana is cracked and needs replacing.',
  boat: 'Diana',
  email_subject: 'Quote request: cracked seat cushion on Diana',
  email_body: 'Hi, the port-side bench cushion on Diana is cracked. Could you send an estimate? Thanks, Off Course Amsterdam',
  reasoning: 'A physical thing is broken and needs fixing.',
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.MAINTENANCE_EMAIL_RECIPIENT = 'handyman@example.com'
})

describe('draftMaintenanceTask', () => {
  it('skips (no AI call) when there is no text and no photo', async () => {
    const sb = makeSupabase()
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftMaintenanceTask({ slackEventId: 'ev1', text: '   ' })).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(describeImageWithGemini).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('skips (no AI call) when a task already exists for this Slack event', async () => {
    const sb = makeSupabase({ dedupe: [{ id: 'existing' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    expect(await draftMaintenanceTask({ slackEventId: 'ev1', text: 'engine sounds weird' })).toBe('skipped')
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('drafts a task + shadow email proposal on the happy path (text only)', async () => {
    const sb = makeSupabase({ dedupe: [], boats: [{ id: 'boat-diana', name: 'Diana' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(HAPPY) as never)

    expect(await draftMaintenanceTask({ slackEventId: 'ev1', text: 'the seat on Diana is cracked', reporter: 'Jannah' })).toBe('drafted')

    // Two inserts: the board record, then the Ghost email proposal.
    expect(sb.inserts.map(i => i.table)).toEqual(['maintenance_tasks', 'agent_proposals'])

    const task = sb.inserts[0].row
    expect(task.priority).toBe('essential')
    expect(task.title).toBe('Cracked seat cushion')
    expect(task.boat_id).toBe('boat-diana') // name → id mapped
    expect(task.status).toBe('open')
    expect(task.source).toBe('slack')
    expect(task.source_slack_event_id).toBe('ev1')
    expect(task.reporter).toBe('Jannah')

    const proposal = sb.inserts[1].row
    expect(proposal.kind).toBe('maintenance_task')
    expect(proposal.status).toBe('shadow') // never auto-sends
    const payload = proposal.payload as Record<string, unknown>
    expect(payload.maintenance_task_id).toBe('task1')
    expect(payload.priority).toBe('essential')
    expect(payload.email_subject).toBe(HAPPY.email_subject)
    expect(payload.email_body).toBe(HAPPY.email_body)
    expect(payload.recipient).toBe('handyman@example.com')

    // The task gets linked back to its proposal.
    expect(sb.updates).toEqual([{ table: 'maintenance_tasks', row: { proposal_id: 'prop1' } }])
  })

  it('describes photos with Gemini and stores the descriptions', async () => {
    const sb = makeSupabase({ dedupe: [], boats: [{ id: 'boat-diana', name: 'Diana' }] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(describeImageWithGemini).mockResolvedValue('A cracked wooden bench on the port side, splintering at the edge.')
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(HAPPY) as never)

    const res = await draftMaintenanceTask({
      slackEventId: 'ev2',
      text: 'look at this',
      photos: [{ base64: 'AAAA', mimeType: 'image/jpeg', url: 'https://files/x.jpg' }],
    })
    expect(res).toBe('drafted')
    expect(describeImageWithGemini).toHaveBeenCalledTimes(1)

    const task = sb.inserts[0].row
    expect(task.photo_descriptions).toEqual(['A cracked wooden bench on the port side, splintering at the edge.'])
    expect(task.photo_urls).toEqual(['https://files/x.jpg'])
  })

  it('still drafts when a photo description fails (one bad photo does not sink it)', async () => {
    const sb = makeSupabase({ dedupe: [], boats: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(describeImageWithGemini).mockRejectedValue(new Error('gemini 500'))
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(HAPPY) as never)

    const res = await draftMaintenanceTask({
      slackEventId: 'ev3',
      text: 'broken thing',
      photos: [{ base64: 'AAAA', mimeType: 'image/jpeg' }],
    })
    expect(res).toBe('drafted')
    expect(sb.inserts[0].row.photo_descriptions).toEqual([]) // failed photo simply omitted
  })

  it('skips (no insert) when the model returns malformed JSON', async () => {
    const sb = makeSupabase({ dedupe: [], boats: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] } as never)

    expect(await draftMaintenanceTask({ slackEventId: 'ev4', text: 'x' })).toBe('skipped')
    expect(sb.inserts).toHaveLength(0)
  })

  it('skips when the priority is not one of essential/cosmetic/wishlist', async () => {
    const sb = makeSupabase({ dedupe: [], boats: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson({ ...HAPPY, priority: 'whatever' }) as never)

    expect(await draftMaintenanceTask({ slackEventId: 'ev5', text: 'x' })).toBe('skipped')
    expect(sb.inserts).toHaveLength(0)
  })

  it('does not write the proposal when the task insert conflicts (concurrent delivery)', async () => {
    const sb = makeSupabase({ dedupe: [], boats: [], taskId: null }) // insert returns error
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(HAPPY) as never)

    expect(await draftMaintenanceTask({ slackEventId: 'ev6', text: 'x' })).toBe('skipped')
    expect(sb.inserts.map(i => i.table)).toEqual(['maintenance_tasks']) // proposal never attempted
  })

  it('swallows errors (returns skipped, never throws) — it runs off a webhook', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('DB exploded')
    })
    await expect(draftMaintenanceTask({ slackEventId: 'ev7', text: 'x' })).resolves.toBe('skipped')
  })
})
