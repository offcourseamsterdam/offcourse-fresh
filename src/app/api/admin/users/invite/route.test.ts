import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  requireRole: vi.fn().mockResolvedValue({ role: 'admin' }),
  inviteUserByEmail: vi.fn(),
  updateProfile: vi.fn(),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/auth/server', () => ({ requireRole: h.requireRole }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { inviteUserByEmail: h.inviteUserByEmail } },
    from: () => ({ update: () => ({ eq: h.updateProfile }) }),
  }),
}))

import { POST } from './route'

function mockReq(body: object): NextRequest {
  return { json: async () => body, url: 'http://localhost:3000/api/admin/users/invite' } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  h.requireRole.mockResolvedValue({ role: 'admin' })
  h.updateProfile.mockResolvedValue({ error: null })
})

describe('POST /api/admin/users/invite', () => {
  it('actually dispatches the invite email via inviteUserByEmail — the whole point of this route', async () => {
    // Regression guard for the 2026-08-21 bug: the previous version called
    // createUser() + generateLink() and discarded the generated link, so it
    // created a real account and reported "Invite sent" while no email ever
    // went out. inviteUserByEmail is the ONLY Supabase admin method that
    // actually sends anything — this test fails if the route ever goes back
    // to a generate-only method.
    h.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const res = await POST(mockReq({ email: 'finance@offcourseamsterdam.com', role: 'admin' }))

    expect(res.status).toBe(200)
    expect(h.inviteUserByEmail).toHaveBeenCalledTimes(1)
    const [email, options] = h.inviteUserByEmail.mock.calls[0]
    expect(email).toBe('finance@offcourseamsterdam.com')
    expect(options.redirectTo).toContain('/auth/callback')
  })

  it('sets the requested role on the profile after the invite goes out', async () => {
    h.inviteUserByEmail.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    await POST(mockReq({ email: 'finance@offcourseamsterdam.com', role: 'support', display_name: 'Finance' }))

    expect(h.updateProfile).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid role before ever calling Supabase', async () => {
    const res = await POST(mockReq({ email: 'x@example.com', role: 'not-a-real-role' }))

    expect(res.status).toBe(400)
    expect(h.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('requires both email and role', async () => {
    const res = await POST(mockReq({ email: 'x@example.com' }))
    expect(res.status).toBe(400)
    expect(h.inviteUserByEmail).not.toHaveBeenCalled()
  })

  it('surfaces a Supabase error (e.g. already-registered) rather than reporting success', async () => {
    h.inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { message: 'User already registered' } })

    const res = await POST(mockReq({ email: 'existing@example.com', role: 'admin' }))

    expect(res.status).not.toBe(200)
    expect((await res.json()).error).toContain('already registered')
    expect(h.updateProfile).not.toHaveBeenCalled()
  })

  it('rejects a non-admin caller before touching Supabase', async () => {
    h.requireRole.mockRejectedValue(new Error('UNAUTHORIZED'))

    const res = await POST(mockReq({ email: 'x@example.com', role: 'admin' }))

    expect(res.status).toBe(403)
    expect(h.inviteUserByEmail).not.toHaveBeenCalled()
  })
})
