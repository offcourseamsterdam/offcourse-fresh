/**
 * Revolut Business API Client (B2B API 1.0)
 *
 * Provides real-time EUR cash balance and transactions directly from Revolut
 * without requiring manual CSV export/imports.
 *
 * Configure REVOLUT_BUSINESS_API_KEY in .env.local (obtained from Revolut Business -> Settings -> API -> Business API).
 */

export interface RevolutAccount {
  id: string
  name: string
  balance: number // In major units (e.g. 34250.75 EUR)
  currency: string
  state: string
  public: boolean
  created_at: string
  updated_at: string
}

export interface RevolutBalanceSummary {
  configured: boolean
  totalEurCents: number
  primaryAccountName: string | null
  accounts: Array<{
    id: string
    name: string
    balanceCents: number
    currency: string
  }>
  lastUpdated: string
}

export class RevolutClient {
  private apiKey: string
  private baseUrl: string

  constructor(apiKey?: string, baseUrl = 'https://b2b.revolut.com/api/1.0') {
    this.apiKey = apiKey || process.env.REVOLUT_BUSINESS_API_KEY || ''
    this.baseUrl = baseUrl
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0)
  }

  async getAccounts(): Promise<RevolutAccount[]> {
    if (!this.isConfigured()) {
      throw new Error('REVOLUT_BUSINESS_API_KEY is not configured')
    }

    const res = await fetch(`${this.baseUrl}/accounts`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
      // Cache 60s to prevent rate limits
      next: { revalidate: 60 },
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Revolut API error (${res.status}): ${errText || res.statusText}`)
    }

    return res.json()
  }

  async getBalanceSummary(): Promise<RevolutBalanceSummary> {
    if (!this.isConfigured()) {
      return {
        configured: false,
        totalEurCents: 0,
        primaryAccountName: null,
        accounts: [],
        lastUpdated: new Date().toISOString(),
      }
    }

    try {
      const accounts = await this.getAccounts()
      const eurAccounts = accounts.filter(a => a.currency === 'EUR' && a.state === 'active')

      let totalEurCents = 0
      const formattedAccounts = eurAccounts.map(a => {
        const cents = Math.round((a.balance || 0) * 100)
        totalEurCents += cents
        return {
          id: a.id,
          name: a.name || 'Revolut EUR',
          balanceCents: cents,
          currency: a.currency,
        }
      })

      return {
        configured: true,
        totalEurCents,
        primaryAccountName: formattedAccounts[0]?.name ?? 'Revolut Zakelijk',
        accounts: formattedAccounts,
        lastUpdated: new Date().toISOString(),
      }
    } catch (error) {
      console.error('[RevolutClient] Failed to fetch balance:', error)
      return {
        configured: true,
        totalEurCents: 0,
        primaryAccountName: null,
        accounts: [],
        lastUpdated: new Date().toISOString(),
      }
    }
  }
}

export const revolut = new RevolutClient()
