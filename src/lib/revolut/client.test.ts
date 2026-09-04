import { describe, it, expect, vi } from 'vitest'
import { RevolutClient, RevolutApiError, ownLeg, toCents, type RevolutTransaction } from './client'

const json = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as Response

function client(fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof RevolutClient>[0]> = {}) {
  return new RevolutClient({ environment: 'sandbox', getAccessToken: async () => 'tok', fetchImpl, ...extra })
}

const tx = (id: string, created: string): RevolutTransaction => ({
  id, type: 'transfer', state: 'completed', created_at: created, updated_at: created,
  legs: [{ leg_id: `${id}-l`, account_id: 'acc', amount: -4.5, currency: 'EUR' }],
})

describe('RevolutClient transport', () => {
  it('sends the bearer token, no-store, and parses JSON', async () => {
    const f = vi.fn().mockResolvedValue(json([{ id: 'a1', balance: 524.8, currency: 'EUR', state: 'active', public: false, created_at: '', updated_at: '' }]))
    const accounts = await client(f).getAccounts()
    expect(accounts[0].balance).toBe(524.8)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('https://sandbox-b2b.revolut.com/api/1.0/accounts')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(init.cache).toBe('no-store')
  })

  it('webhook endpoints use the v2 base', async () => {
    const f = vi.fn().mockResolvedValue(json({ id: 'w1', url: 'https://x', events: ['TransactionCreated'], signing_secret: 's' }))
    await client(f).createWebhook('https://x', ['TransactionCreated'])
    expect(f.mock.calls[0][0]).toBe('https://sandbox-b2b.revolut.com/api/2.0/webhooks')
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ url: 'https://x', events: ['TransactionCreated'] })
  })

  it('retries once after a 401 via onUnauthorized', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'expired' } as Response)
      .mockResolvedValueOnce(json([]))
    const onUnauthorized = vi.fn().mockResolvedValue(undefined)
    await client(f, { onUnauthorized }).getAccounts()
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('does not loop on a second 401', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'nope' } as Response)
    const onUnauthorized = vi.fn().mockResolvedValue(undefined)
    await expect(client(f, { onUnauthorized }).getAccounts()).rejects.toBeInstanceOf(RevolutApiError)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('throws RevolutApiError with status and redacted body', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => '{"message":"bad oa_sand_secret"}' } as Response)
    const err = await client(f).createCounterparty({ bank_country: 'NL', currency: 'EUR', iban: 'NL00' }).catch(e => e)
    expect(err).toBeInstanceOf(RevolutApiError)
    expect(err.status).toBe(422)
    expect(err.message).toContain('oa_sand_[redacted]')
  })

  it('DELETE with an empty body resolves undefined', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => '' } as Response)
    await expect(client(f).deleteWebhook('w1')).resolves.toBeUndefined()
    expect(f.mock.calls[0][1].method).toBe('DELETE')
  })
})

describe('getTransactions query building', () => {
  it('serialises from/to/count/account and repeated state params', async () => {
    const f = vi.fn().mockResolvedValue(json([]))
    await client(f).getTransactions({ from: '2026-08-01', to: '2026-09-04T10:00:00Z', count: 100, account: 'acc', state: ['pending', 'completed'] })
    const url = new URL(f.mock.calls[0][0])
    expect(url.pathname).toBe('/api/1.0/transactions')
    expect(url.searchParams.get('from')).toBe('2026-08-01')
    expect(url.searchParams.get('count')).toBe('100')
    expect(url.searchParams.getAll('state')).toEqual(['pending', 'completed'])
  })
})

describe('listTransactionsSince pagination', () => {
  it('follows created_at of the last item as the next `to`, de-duplicates, stops on a short page', async () => {
    const page1 = [tx('c', '2026-09-03T10:00:00Z'), tx('b', '2026-09-02T10:00:00Z')]
    const page2 = [tx('a', '2026-09-01T10:00:00Z')] // short page → last
    const f = vi.fn().mockResolvedValueOnce(json(page1)).mockResolvedValueOnce(json(page2))
    const all = await client(f).listTransactionsSince('2026-08-01', undefined, { pageSize: 2 })
    expect(all.map(t => t.id)).toEqual(['c', 'b', 'a'])
    expect(new URL(f.mock.calls[1][0]).searchParams.get('to')).toBe('2026-09-02T10:00:00Z')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('stops when a full page adds nothing new (guards against an infinite loop)', async () => {
    const same = [tx('x', '2026-09-03T10:00:00Z'), tx('y', '2026-09-03T10:00:00Z')]
    const f = vi.fn().mockResolvedValue(json(same))
    const all = await client(f).listTransactionsSince('2026-08-01', undefined, { pageSize: 2 })
    expect(all).toHaveLength(2)
    expect(f).toHaveBeenCalledTimes(2)
  })
})

describe('helpers', () => {
  it('toCents rounds major units', () => {
    expect(toCents(524.8)).toBe(52480)
    expect(toCents(-47.8)).toBe(-4780)
    expect(toCents(undefined)).toBe(0)
    expect(toCents(0.1 + 0.2)).toBe(30)
  })
  it('ownLeg picks our account leg, falling back to the first', () => {
    const t = tx('t', '2026-09-01T00:00:00Z')
    t.legs = [{ leg_id: '1', account_id: 'other', amount: 1, currency: 'EUR' }, { leg_id: '2', account_id: 'acc', amount: -1, currency: 'EUR' }]
    expect(ownLeg(t, 'acc')?.leg_id).toBe('2')
    expect(ownLeg(t, 'missing')?.leg_id).toBe('1')
  })
})
