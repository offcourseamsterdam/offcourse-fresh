import { describe, it, expect, vi } from 'vitest'
import { RevolutClient } from './client'

describe('RevolutClient', () => {
  it('returns not configured when api key is missing', async () => {
    const client = new RevolutClient('')
    expect(client.isConfigured()).toBe(false)

    const summary = await client.getBalanceSummary()
    expect(summary.configured).toBe(false)
    expect(summary.totalEurCents).toBe(0)
    expect(summary.accounts).toEqual([])
  })

  it('parses accounts correctly into balance summary', async () => {
    const client = new RevolutClient('mock_key')
    expect(client.isConfigured()).toBe(true)

    // Mock getAccounts
    vi.spyOn(client, 'getAccounts').mockResolvedValue([
      {
        id: 'acc_1',
        name: 'Hoofd Zakelijk EUR',
        balance: 24500.5,
        currency: 'EUR',
        state: 'active',
        public: true,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'acc_2',
        name: 'Spaarrekening EUR',
        balance: 10000,
        currency: 'EUR',
        state: 'active',
        public: true,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'acc_3',
        name: 'USD Account',
        balance: 500,
        currency: 'USD',
        state: 'active',
        public: true,
        created_at: '',
        updated_at: '',
      },
    ])

    const summary = await client.getBalanceSummary()
    expect(summary.configured).toBe(true)
    expect(summary.totalEurCents).toBe(3450050) // € 34.500,50
    expect(summary.accounts.length).toBe(2)
    expect(summary.primaryAccountName).toBe('Hoofd Zakelijk EUR')
  })
})
