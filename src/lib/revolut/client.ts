/**
 * Typed Revolut Business API client (v1.0). Pure I/O: it is handed a function
 * that returns a valid access token (token-store.ts) and never caches anything
 * itself. Every request is `cache: 'no-store'` — bank data must never pass
 * through Next's data cache.
 *
 * Endpoints (verified 2026-09-04): GET /accounts, GET /accounts/{id},
 * GET /transactions (paginated by created_at, ≤1000), GET /transaction/{id},
 * POST /counterparty, GET /counterparties, POST /payment-drafts,
 * GET /payment-drafts/{id}, POST /webhooks, GET /webhooks, DELETE /webhooks/{id},
 * POST /webhooks/{id}/rotate-signing-secret.
 */

import { REVOLUT_API_BASE, redact, type RevolutEnvironment } from './auth'

/** Webhooks v2 live under /api/2.0 while everything else is /api/1.0 (verified 2026-09-04). */
export const REVOLUT_API_V2_BASE: Record<RevolutEnvironment, string> = {
  sandbox: 'https://sandbox-b2b.revolut.com/api/2.0',
  production: 'https://b2b.revolut.com/api/2.0',
}

export interface RevolutAccount {
  id: string
  name?: string
  balance: number // major units
  currency: string
  state: 'active' | 'inactive' | string
  public: boolean
  account_type?: string
  created_at: string
  updated_at: string
}

export type RevolutTransactionState = 'created' | 'pending' | 'completed' | 'declined' | 'failed' | 'reverted'

export interface RevolutTransactionLeg {
  leg_id: string
  account_id: string
  amount: number
  fee?: number
  currency: string
  bill_amount?: number
  bill_currency?: string
  description?: string
  balance?: number
  counterparty?: { id?: string; account_id?: string; account_type?: string; name?: string }
}

export interface RevolutTransaction {
  id: string
  type: string
  state: RevolutTransactionState | string
  request_id?: string
  reason_code?: string
  created_at: string
  updated_at: string
  completed_at?: string
  scheduled_for?: string
  related_transaction_id?: string
  reference?: string
  merchant?: { name?: string; full_name?: string; city?: string; category_code?: string; country?: string }
  card?: unknown
  legs: RevolutTransactionLeg[]
}

export interface RevolutCounterparty {
  id: string
  name?: string
  state?: string
  profile_type?: 'personal' | 'business'
  country?: string
  accounts?: Array<{ id: string; currency?: string; iban?: string; bic?: string; name?: string; account_no?: string; bank_country?: string; type?: string }>
  created_at?: string
  updated_at?: string
}

export interface CreateCounterpartyInput {
  /** Business recipient → company_name; individual → individual_name. */
  company_name?: string
  individual_name?: { first_name: string; last_name: string }
  bank_country: string // 'NL'
  currency: string // 'EUR'
  iban: string
  bic?: string
  address?: { street_line1?: string; street_line2?: string; region?: string; city?: string; country: string; postcode?: string }
}

export interface PaymentDraftPayment {
  account_id: string
  receiver: { counterparty_id: string; account_id?: string }
  amount: number // major units
  currency: string
  reference: string
}

export interface PaymentDraft {
  id: string
  title?: string
  scheduled_for?: string
  payments?: Array<PaymentDraftPayment & { id?: string; state?: string; transaction_id?: string }>
  state?: string
}

export interface RevolutWebhook {
  id: string
  url: string
  events: string[]
  signing_secret?: string
}

export type TokenProvider = () => Promise<string>

export class RevolutApiError extends Error {
  constructor(public status: number, message: string, public body?: string) {
    super(message)
  }
}

export interface RevolutClientOptions {
  environment: RevolutEnvironment
  getAccessToken: TokenProvider
  /** Called once after a 401 so the caller can force a refresh; then the request is retried once. */
  onUnauthorized?: () => Promise<void>
  fetchImpl?: typeof fetch
}

export class RevolutClient {
  private readonly base: string
  constructor(private readonly opts: RevolutClientOptions) {
    this.base = REVOLUT_API_BASE[opts.environment]
  }

  // ── Accounts ───────────────────────────────────────────────────────────────
  getAccounts(): Promise<RevolutAccount[]> {
    return this.request('GET', '/accounts')
  }
  getAccount(id: string): Promise<RevolutAccount> {
    return this.request('GET', `/accounts/${encodeURIComponent(id)}`)
  }

  // ── Transactions ───────────────────────────────────────────────────────────
  /** One page, newest first. Use listTransactionsSince() for a full window. */
  getTransactions(params: { from?: string; to?: string; count?: number; account?: string; type?: string; state?: string[] } = {}): Promise<RevolutTransaction[]> {
    const q = new URLSearchParams()
    if (params.from) q.set('from', params.from)
    if (params.to) q.set('to', params.to)
    if (params.count) q.set('count', String(params.count))
    if (params.account) q.set('account', params.account)
    if (params.type) q.set('type', params.type)
    for (const s of params.state ?? []) q.append('state', s)
    const qs = q.toString()
    return this.request('GET', `/transactions${qs ? `?${qs}` : ''}`)
  }

  /**
   * Every transaction created in [from, to], following Revolut's pagination:
   * the next page is requested with `to` = created_at of the last item.
   */
  async listTransactionsSince(from: string, to?: string, opts: { account?: string; pageSize?: number; maxPages?: number } = {}): Promise<RevolutTransaction[]> {
    const pageSize = Math.min(1000, opts.pageSize ?? 500)
    const out: RevolutTransaction[] = []
    const seen = new Set<string>()
    let cursor = to
    for (let page = 0; page < (opts.maxPages ?? 50); page++) {
      const batch = await this.getTransactions({ from, to: cursor, count: pageSize, account: opts.account })
      let added = 0
      for (const t of batch) {
        if (!seen.has(t.id)) { seen.add(t.id); out.push(t); added++ }
      }
      if (batch.length < pageSize || added === 0) break
      cursor = batch[batch.length - 1].created_at
    }
    return out
  }

  getTransaction(id: string): Promise<RevolutTransaction> {
    return this.request('GET', `/transaction/${encodeURIComponent(id)}`)
  }

  // ── Counterparties ─────────────────────────────────────────────────────────
  getCounterparties(): Promise<RevolutCounterparty[]> {
    return this.request('GET', '/counterparties')
  }
  createCounterparty(input: CreateCounterpartyInput): Promise<RevolutCounterparty> {
    return this.request('POST', '/counterparty', input)
  }

  // ── Payment drafts (WRITE scope; Beer approves in the Revolut app) ─────────
  createPaymentDraft(input: { title: string; schedule_for?: string; payments: PaymentDraftPayment[] }): Promise<{ id: string }> {
    return this.request('POST', '/payment-drafts', input)
  }
  getPaymentDraft(id: string): Promise<PaymentDraft> {
    return this.request('GET', `/payment-drafts/${encodeURIComponent(id)}`)
  }
  deletePaymentDraft(id: string): Promise<void> {
    return this.request('DELETE', `/payment-drafts/${encodeURIComponent(id)}`)
  }

  // ── Webhooks v2 ────────────────────────────────────────────────────────────
  listWebhooks(): Promise<RevolutWebhook[]> {
    return this.request('GET', '/webhooks', undefined, false, 'v2')
  }
  getWebhook(id: string): Promise<RevolutWebhook> {
    return this.request('GET', `/webhooks/${encodeURIComponent(id)}`, undefined, false, 'v2')
  }
  createWebhook(url: string, events: string[] = ['TransactionCreated', 'TransactionStateChanged']): Promise<RevolutWebhook> {
    return this.request('POST', '/webhooks', { url, events }, false, 'v2')
  }
  deleteWebhook(id: string): Promise<void> {
    return this.request('DELETE', `/webhooks/${encodeURIComponent(id)}`, undefined, false, 'v2')
  }
  rotateWebhookSecret(id: string, expirationPeriod?: string): Promise<RevolutWebhook> {
    return this.request('POST', `/webhooks/${encodeURIComponent(id)}/rotate-signing-secret`, expirationPeriod ? { expiration_period: expirationPeriod } : {}, false, 'v2')
  }

  // ── Transport ──────────────────────────────────────────────────────────────
  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, retried = false, version: 'v1' | 'v2' = 'v1'): Promise<T> {
    const token = await this.opts.getAccessToken()
    const f = this.opts.fetchImpl ?? fetch
    const base = version === 'v2' ? REVOLUT_API_V2_BASE[this.opts.environment] : this.base
    const res = await f(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
    if (res.status === 401 && !retried && this.opts.onUnauthorized) {
      await this.opts.onUnauthorized()
      return this.request<T>(method, path, body, true, version)
    }
    const text = await res.text()
    if (!res.ok) {
      throw new RevolutApiError(res.status, `Revolut ${method} ${path} failed (${res.status}): ${redact(text)}`, text)
    }
    if (!text) return undefined as T
    return JSON.parse(text) as T
  }
}

/** Revolut amounts are decimal major units; we store integer cents. */
export function toCents(amount: number | undefined | null): number {
  return Math.round((amount ?? 0) * 100)
}

/** Our own leg on a transaction (the one on `accountId`), or the first leg. */
export function ownLeg(tx: RevolutTransaction, accountId?: string): RevolutTransactionLeg | undefined {
  if (accountId) {
    const leg = tx.legs.find(l => l.account_id === accountId)
    if (leg) return leg
  }
  return tx.legs[0]
}
