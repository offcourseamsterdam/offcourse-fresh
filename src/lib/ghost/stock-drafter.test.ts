import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/ai/usage', () => ({ meteredMessage: vi.fn() }))

import { draftStockReorders } from './stock-drafter'
import { createAdminClient } from '@/lib/supabase/admin'
import { meteredMessage } from '@/lib/ai/usage'

/**
 * Supabase stub: the two reads (stock_items, recent agent_proposals) resolve
 * via `then`; the proposal insert is captured and resolves to { error }.
 */
function makeSupabase(opts: { items?: unknown[]; recent?: unknown[]; insertError?: unknown } = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      gte: () => builder,
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        return { then: (res: (v: unknown) => unknown) => Promise.resolve({ error: opts.insertError ?? null }).then(res) }
      },
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
        let result: { data: unknown; error: null } = { data: [], error: null }
        if (table === 'stock_items') result = { data: opts.items ?? [], error: null }
        else if (table === 'agent_proposals') result = { data: opts.recent ?? [], error: null }
        return Promise.resolve(result).then(res, rej)
      },
    }
    return builder
  })
  return { client: { from }, from, inserts }
}

function claudeJson(obj: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] }
}

const DRAFT = { email_subject: 'Reorder please', email_body: 'Hi, please send more. Off Course Amsterdam', reasoning: 'Ice tea is low.' }

function item(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'i1', name: 'Ice tea', unit: 'tray', pack_size: null, pack_unit: null,
    current_count: 1, reorder_threshold: 2, reorder_qty: 10,
    supplier_name: 'DrinksCo', supplier_email: 'orders@drinksco.com', ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  process.env.STOCK_EMAIL_RECIPIENT = 'fallback@example.com'
})

describe('draftStockReorders', () => {
  it('skips (no AI call) when nothing is low', async () => {
    const sb = makeSupabase({ items: [item({ current_count: 9, reorder_threshold: 2 })] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    expect(await draftStockReorders()).toEqual({ drafted: 0, skipped: 0 })
    expect(meteredMessage).not.toHaveBeenCalled()
    expect(sb.inserts).toHaveLength(0)
  })

  it('does not treat an untracked item (threshold 0) as low even at zero', async () => {
    const sb = makeSupabase({ items: [item({ current_count: 0, reorder_threshold: 0 })] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    expect(await draftStockReorders()).toEqual({ drafted: 0, skipped: 0 })
    expect(meteredMessage).not.toHaveBeenCalled()
  })

  it('drafts one shadow proposal for a low item (correct payload)', async () => {
    const sb = makeSupabase({ items: [item({ current_count: 1, reorder_threshold: 2, reorder_qty: 10 })] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(DRAFT) as never)

    const res = await draftStockReorders()
    expect(res.drafted).toBe(1)
    expect(meteredMessage).toHaveBeenCalledTimes(1)

    const proposal = sb.inserts.find(i => i.table === 'agent_proposals')!.row
    expect(proposal.kind).toBe('stock_reorder')
    expect(proposal.status).toBe('shadow')
    const payload = proposal.payload as Record<string, unknown>
    expect(payload.recipient).toBe('orders@drinksco.com') // per-item supplier wins
    expect(payload.supplier_key).toBe('orders@drinksco.com')
    expect(payload.urgency).toBe('routine')
    expect(payload.item_ids).toEqual(['i1'])
    expect(payload.items).toEqual([{ name: 'Ice tea', quantity: 10, unit: 'tray', pack_size: null, pack_unit: null }])
    expect(payload.email_body).toBe(DRAFT.email_body)
  })

  it('carries pack size into the payload + prompt (box of 12 bottles)', async () => {
    const sb = makeSupabase({ items: [item({ name: 'Wine — White', unit: 'box', pack_size: 12, pack_unit: 'bottles', current_count: 1, reorder_threshold: 2, reorder_qty: 4 })] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(DRAFT) as never)

    await draftStockReorders()
    const payload = sb.inserts[0].row.payload as Record<string, unknown>
    expect(payload.items).toEqual([{ name: 'Wine — White', quantity: 4, unit: 'box', pack_size: 12, pack_unit: 'bottles' }])
    // The prompt the model saw mentions the pack contents.
    const call = vi.mocked(meteredMessage).mock.calls[0][1] as { messages: { content: string }[] }
    expect(call.messages[0].content).toContain('12 bottles per box')
  })

  it('groups multiple low items from the same supplier into ONE draft', async () => {
    const sb = makeSupabase({ items: [
      item({ id: 'a', name: 'Ice tea', current_count: 1, reorder_threshold: 2 }),
      item({ id: 'b', name: 'Cola', current_count: 0, reorder_threshold: 3 }),
    ] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(DRAFT) as never)

    const res = await draftStockReorders()
    expect(res.drafted).toBe(1)
    expect(meteredMessage).toHaveBeenCalledTimes(1) // one email for the supplier
    const payload = sb.inserts[0].row.payload as Record<string, unknown>
    expect(payload.item_ids).toEqual(['a', 'b'])
    expect(payload.urgency).toBe('urgent') // Cola is at 0
  })

  it('drafts separately for two different suppliers', async () => {
    const sb = makeSupabase({ items: [
      item({ id: 'a', supplier_email: 'one@x.com', current_count: 0, reorder_threshold: 2 }),
      item({ id: 'b', supplier_email: 'two@y.com', current_count: 1, reorder_threshold: 2 }),
    ] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(DRAFT) as never)

    const res = await draftStockReorders()
    expect(res.drafted).toBe(2)
    expect(meteredMessage).toHaveBeenCalledTimes(2)
  })

  it('dedupes: a supplier already drafted recently is skipped (no AI call)', async () => {
    const sb = makeSupabase({
      items: [item({ supplier_email: 'orders@drinksco.com', current_count: 1, reorder_threshold: 2 })],
      recent: [{ payload: { supplier_key: 'orders@drinksco.com' }, status: 'shadow', created_at: '2026-06-15T00:00:00Z' }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    expect(await draftStockReorders()).toEqual({ drafted: 0, skipped: 1 })
    expect(meteredMessage).not.toHaveBeenCalled()
  })

  it('falls back to STOCK_EMAIL_RECIPIENT when an item has no supplier email', async () => {
    const sb = makeSupabase({ items: [item({ supplier_email: null, supplier_name: 'NoEmail Co', current_count: 0, reorder_threshold: 1 })] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue(claudeJson(DRAFT) as never)

    await draftStockReorders()
    const payload = sb.inserts[0].row.payload as Record<string, unknown>
    expect(payload.recipient).toBe('fallback@example.com')
    expect(payload.supplier_key).toBe('NoEmail Co')
  })

  it('skips a supplier when the model returns malformed JSON', async () => {
    const sb = makeSupabase({ items: [item({ current_count: 0, reorder_threshold: 2 })] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)
    vi.mocked(meteredMessage).mockResolvedValue({ content: [{ type: 'text', text: 'not json' }] } as never)

    expect(await draftStockReorders()).toEqual({ drafted: 0, skipped: 1 })
    expect(sb.inserts).toHaveLength(0)
  })

  it('swallows errors (never throws) — it runs off a request', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => { throw new Error('DB down') })
    await expect(draftStockReorders()).resolves.toEqual({ drafted: 0, skipped: 0 })
  })
})
