import { describe, it, expect, vi } from 'vitest'
import { logWebhookEvent } from './log'

function fakeSupabase(insertImpl?: (row: Record<string, unknown>) => unknown) {
  const captured: Record<string, unknown>[] = []
  const client = {
    captured,
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        captured.push(row)
        return Promise.resolve(insertImpl ? insertImpl(row) : { error: null })
      },
    }),
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client as any
}

describe('logWebhookEvent', () => {
  it('records the provider event with a processed_at stamp when processed', async () => {
    const supabase = fakeSupabase()
    await logWebhookEvent(supabase, {
      source: 'stripe',
      providerEventId: 'evt_123',
      signatureValid: true,
      payload: { type: 'payment_intent.succeeded' },
      processed: true,
    })

    expect(supabase.captured).toHaveLength(1)
    const row = supabase.captured[0]
    expect(row.source).toBe('stripe')
    expect(row.provider_event_id).toBe('evt_123')
    expect(row.signature_valid).toBe(true)
    expect(row.processed).toBe(true)
    expect(row.processed_at).toBeTruthy()
  })

  it('leaves processed_at null when not processed', async () => {
    const supabase = fakeSupabase()
    await logWebhookEvent(supabase, { source: 'outscraper', providerEventId: null, signatureValid: false, payload: {} })
    expect(supabase.captured[0].processed).toBe(false)
    expect(supabase.captured[0].processed_at).toBeNull()
  })

  it('never throws when the insert blows up (best-effort breadcrumb)', async () => {
    const supabase = fakeSupabase(() => { throw new Error('db down') })
    await expect(
      logWebhookEvent(supabase, { source: 'stripe', providerEventId: 'evt_x', signatureValid: true, payload: {} }),
    ).resolves.toBeUndefined()
  })
})
