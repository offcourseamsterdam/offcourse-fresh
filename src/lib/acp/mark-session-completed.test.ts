import { describe, it, expect, vi, beforeEach } from 'vitest'
import { markAcpSessionCompleted } from './mark-session-completed'

const h = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({ update: h.update }),
  }),
}))

describe('markAcpSessionCompleted', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.update.mockReturnValue({ eq: h.eq })
    h.eq.mockResolvedValue({ error: null })
  })

  it('does nothing for a non-ACP PaymentIntent (no session id)', async () => {
    await markAcpSessionCompleted(undefined, 'booking-1')
    expect(h.update).not.toHaveBeenCalled()
  })

  it('flips the session to completed with the booking id', async () => {
    await markAcpSessionCompleted('cs_abc', 'booking-1')
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', booking_id: 'booking-1' }))
    expect(h.eq).toHaveBeenCalledWith('id', 'cs_abc')
  })

  it('swallows a DB error rather than throwing (the booking already succeeded)', async () => {
    h.eq.mockResolvedValue({ error: { message: 'db down' } })
    await expect(markAcpSessionCompleted('cs_abc', 'booking-1')).resolves.toBeUndefined()
  })

  it('swallows an unexpected thrown error rather than propagating it', async () => {
    h.update.mockImplementation(() => { throw new Error('boom') })
    await expect(markAcpSessionCompleted('cs_abc', 'booking-1')).resolves.toBeUndefined()
  })
})
