import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Test the transport itself (header construction, error handling) with a mocked
// fetch + mocked OAuth — no network. Locks in the subtle rule that
// login-customer-id is sent on normal calls but OMITTED for listAccessibleCustomers.
vi.mock('./auth', () => ({ getAccessToken: vi.fn(async () => 'fake-token') }))

import { googleAdsCall } from './campaign-client'

type FetchInit = { method: string; headers: Record<string, string>; body?: string }
const fetchMock = (status: number, jsonBody: unknown) =>
  vi.fn(async (_url: string, _init: FetchInit) => ({ ok: status >= 200 && status < 300, status, json: async () => jsonBody }))
const headersOf = (f: ReturnType<typeof fetchMock>): Record<string, string> =>
  f.mock.calls[0][1].headers

beforeEach(() => {
  vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '1234567890')
  vi.stubEnv('GOOGLE_ADS_DEVELOPER_TOKEN', 'dev-token')
  vi.stubEnv('GOOGLE_ADS_LOGIN_CUSTOMER_ID', '999')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('googleAdsCall transport', () => {
  it('sends Authorization, developer-token and login-customer-id on a normal call', async () => {
    const f = fetchMock(200, { results: [] })
    vi.stubGlobal('fetch', f)
    const res = await googleAdsCall('customers/1234567890/googleAds:search', { method: 'POST', body: { query: 'x' } })
    expect(res.ok).toBe(true)
    const h = headersOf(f)
    expect(h['Authorization']).toBe('Bearer fake-token')
    expect(h['developer-token']).toBe('dev-token')
    expect(h['login-customer-id']).toBe('999')
  })

  it('OMITS login-customer-id for customers:listAccessibleCustomers', async () => {
    const f = fetchMock(200, { resourceNames: [] })
    vi.stubGlobal('fetch', f)
    await googleAdsCall('customers:listAccessibleCustomers', { method: 'GET' })
    expect(headersOf(f)['login-customer-id']).toBeUndefined()
  })

  it('returns ok:false with an extracted message on a non-2xx', async () => {
    vi.stubGlobal('fetch', fetchMock(404, { error: { message: 'Not found.' } }))
    const res = await googleAdsCall('customers/1234567890/campaigns:mutate', { method: 'POST', body: {} })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
    expect(res.error).toBe('Not found.')
  })

  it('treats a 200 carrying partialFailureError as a failure', async () => {
    vi.stubGlobal('fetch', fetchMock(200, { partialFailureError: { message: 'op 0 bad' } }))
    const res = await googleAdsCall('customers/1234567890/adGroupCriteria:mutate', { method: 'POST', body: {} })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('op 0 bad')
  })

  it('short-circuits with a config error (no fetch) when required env is missing', async () => {
    vi.stubEnv('GOOGLE_ADS_CUSTOMER_ID', '')
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const res = await googleAdsCall('customers/x/googleAds:search', { method: 'POST', body: {} })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/not configured/)
    expect(f).not.toHaveBeenCalled()
  })
})
