import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(() => ({})),
  forward: vi.fn(),
  detail: vi.fn(),
  confirm: vi.fn(),
  link: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/finance/expenses/forward-snelstart', () => ({ forwardExpenseToSnelstart: h.forward }))
vi.mock('@/lib/finance/expenses/actions', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/finance/expenses/actions')>()),
  loadExpenseDetail: h.detail,
  confirmMatch: h.confirm,
  linkDocument: h.link,
}))

import { POST } from './route'
import { ExpenseActionError } from '@/lib/finance/expenses/actions'

const post = (body: unknown) =>
  POST(new NextRequest('https://offcourseamsterdam.com/api/admin/finance/expenses/e1/actions', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), {
    params: Promise.resolve({ id: 'e1' }),
  })

describe('POST /api/admin/finance/expenses/[id]/actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.detail.mockResolvedValue({ expense: { id: 'e1' }, documents: [], derivedStatus: 'matched', provenanceTrusted: true })
  })

  it('a denied admin never reaches an action', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 401 }))
    expect((await post({ action: 'forward' })).status).toBe(401)
    expect(h.forward).not.toHaveBeenCalled()
  })

  it('an unknown or malformed action body is a 400', async () => {
    expect((await post({ action: 'explode' })).status).toBe(400)
    expect((await post({ action: 'link' })).status).toBe(400) // documentId missing
    expect((await post({ action: 'vat', vatCents: -5 })).status).toBe(400)
  })

  it('a confirmed action returns the refreshed detail', async () => {
    h.confirm.mockResolvedValue(null)
    const res = await post({ action: 'confirm' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ derivedStatus: 'matched', provenanceTrusted: true })
    expect(h.confirm).toHaveBeenCalledWith(expect.anything(), 'e1')
  })

  it('an ExpenseActionError keeps its status (409) and message', async () => {
    h.link.mockRejectedValue(new ExpenseActionError('al gekoppeld', 409))
    const res = await post({ action: 'link', documentId: '11111111-1111-4111-8111-111111111111' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('al gekoppeld')
  })

  it('a refused forward is a 409 with the reason code — and never the internal detail (storage paths, raw Gmail errors)', async () => {
    h.forward.mockResolvedValue({ ok: false, reason: 'download_failed', detail: 'email/g1/secret-path.pdf' })
    const res = await post({ action: 'forward' })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.reason).toBe('download_failed')
    expect(JSON.stringify(body)).not.toContain('secret-path')
    h.forward.mockResolvedValue({ ok: false, reason: 'not_found' })
    expect((await post({ action: 'forward' })).status).toBe(404)
    h.forward.mockResolvedValue({ ok: false, reason: 'not_confirmed' })
    expect((await (await post({ action: 'forward' })).json()).error).toContain('bevestigen')
  })

  it('an unexpected error is a 500, not a crash', async () => {
    h.confirm.mockRejectedValue(new Error('db down'))
    expect((await post({ action: 'confirm' })).status).toBe(500)
  })
})
