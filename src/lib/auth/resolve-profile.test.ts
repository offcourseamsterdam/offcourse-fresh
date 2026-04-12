import { describe, it, expect, vi } from 'vitest'
import { resolveProfile } from './resolve-profile'

// ── Helpers ──────────────────────────────────────────────────────────────

function mockAdmin({
  selectResult = null,
  selectError = null,
  insertResult = null,
  insertError = null,
}: {
  selectResult?: Record<string, unknown> | null
  selectError?: { message: string } | null
  insertResult?: Record<string, unknown> | null
  insertError?: { message: string } | null
} = {}) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: selectResult, error: selectError }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: insertResult, error: insertError }),
        }),
      }),
    }),
  } as any
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('resolveProfile', () => {
  const user = { id: 'user-123', email: 'test@example.com' }

  it('returns existing profile when found', async () => {
    const profile = { id: 'user-123', email: 'test@example.com', role: 'admin', is_active: true }
    const admin = mockAdmin({ selectResult: profile })

    const result = await resolveProfile(admin, user)

    expect(result).toEqual({ profile, error: null })
  })

  it('auto-creates guest profile when none exists', async () => {
    const newProfile = { id: 'user-123', email: 'test@example.com', role: 'guest', is_active: true }
    const admin = mockAdmin({ selectResult: null, insertResult: newProfile })

    const result = await resolveProfile(admin, user)

    expect(result).toEqual({ profile: newProfile, error: null })
  })

  it('returns error when profile creation fails', async () => {
    const admin = mockAdmin({
      selectResult: null,
      insertError: { message: 'duplicate key' },
    })

    const result = await resolveProfile(admin, user)

    expect(result.profile).toBeNull()
    expect(result.error).toBe('no_profile')
  })

  it('returns deactivated error for inactive profiles', async () => {
    const profile = { id: 'user-123', email: 'test@example.com', role: 'guest', is_active: false }
    const admin = mockAdmin({ selectResult: profile })

    const result = await resolveProfile(admin, user)

    expect(result.profile).toBeNull()
    expect(result.error).toBe('deactivated')
  })

  it('uses user email for new profile', async () => {
    const newProfile = { id: 'user-456', email: 'new@example.com', role: 'guest', is_active: true }
    const admin = mockAdmin({ selectResult: null, insertResult: newProfile })
    const newUser = { id: 'user-456', email: 'new@example.com' }

    const result = await resolveProfile(admin, newUser)

    expect(result.profile?.email).toBe('new@example.com')
  })

  it('handles user with no email gracefully', async () => {
    const newProfile = { id: 'user-789', email: '', role: 'guest', is_active: true }
    const admin = mockAdmin({ selectResult: null, insertResult: newProfile })
    const noEmailUser = { id: 'user-789', email: undefined }

    const result = await resolveProfile(admin, noEmailUser as any)

    expect(result.profile?.email).toBe('')
  })
})
