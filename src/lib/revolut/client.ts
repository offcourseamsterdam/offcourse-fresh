/**
 * Revolut Business API Client (B2B API 1.0)
 *
 * Provides real-time EUR cash balance and transactions directly from Revolut
 * without requiring manual CSV export/imports.
 *
 * Configure REVOLUT_BUSINESS_API_KEY in .env.local (obtained from Revolut Business -> Settings -> API -> Business API).
 */

import { getValidRevolutAccessToken } from './auth'

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

export interface RevolutTransaction {
  id: string
  type: string
  state: string
  created_at: string
  updated_at: string
  completed_at?: string
  legs: Array<{
    leg_id: string
    amount: number
    currency: string
    bill_amount?: number
    bill_currency?: string
    account_id: string
    description: string
    balance?: number
  }>
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
    if (this.apiKey && this.apiKey.trim().length > 0) return true
    if (process.env.REVOLUT_BUSINESS_API_KEY && process.env.REVOLUT_BUSINESS_API_KEY.trim().length > 0) return true
    if (process.env.REVOLUT_CLIENT_ID && process.env.REVOLUT_REFRESH_TOKEN) return true
    return false
  }

  private async getToken(): Promise<string> {
    if (this.apiKey && this.apiKey.trim().length > 0) return this.apiKey.trim()
    const oauthToken = await getValidRevolutAccessToken()
    if (oauthToken) return oauthToken
    throw new Error('Revolut Business API is not configured (missing API key or OAuth credentials)')
  }

  async getAccounts(): Promise<RevolutAccount[]> {
    const token = await this.getToken()

    const res = await fetch(`${this.baseUrl}/accounts`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
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

  async getTransactions(params?: { from?: string; to?: string; count?: number }): Promise<RevolutTransaction[]> {
    const token = await this.getToken()
    const query = new URLSearchParams()
    if (params?.from) query.set('from', params.from)
    if (params?.to) query.set('to', params.to)
    if (params?.count) query.set('count', String(params.count))

    const url = `${this.baseUrl}/transactions${query.toString() ? `?${query.toString()}` : ''}`
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      next: { revalidate: 60 },
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      throw new Error(`Revolut transactions error (${res.status}): ${errText || res.statusText}`)
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
