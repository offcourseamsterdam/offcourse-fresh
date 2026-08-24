import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ maybeSingle: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: h.maybeSingle }),
      }),
    }),
  }),
}))

import { resolveCateringEmailRecipient, isExternalCateringRecipient } from './recipient'

beforeEach(() => {
  h.maybeSingle.mockReset()
  vi.stubEnv('CATERING_EMAIL_RECIPIENT', 'caterer@example.com')
})

describe('resolveCateringEmailRecipient', () => {
  it('returns the site-wide default when no listingId is given (no DB lookup)', async () => {
    const recipient = await resolveCateringEmailRecipient(null)
    expect(recipient).toBe('caterer@example.com')
    expect(h.maybeSingle).not.toHaveBeenCalled()
  })

  it("returns the site-wide default when the listing has no override set", async () => {
    h.maybeSingle.mockResolvedValue({ data: { catering_email_recipient: null }, error: null })
    const recipient = await resolveCateringEmailRecipient('listing-1')
    expect(recipient).toBe('caterer@example.com')
  })

  it('returns the listing override when one is set', async () => {
    h.maybeSingle.mockResolvedValue({ data: { catering_email_recipient: 'info@ashs-plek.nl' }, error: null })
    const recipient = await resolveCateringEmailRecipient('jamaican-buffet-listing')
    expect(recipient).toBe('info@ashs-plek.nl')
  })

  it('falls back to the hardcoded default when CATERING_EMAIL_RECIPIENT is unset', async () => {
    vi.unstubAllEnvs()
    const recipient = await resolveCateringEmailRecipient(null)
    expect(recipient).toBe('info@offcourseamsterdam.com')
  })
})

describe('isExternalCateringRecipient', () => {
  it('is false for the site-wide default', () => {
    expect(isExternalCateringRecipient('caterer@example.com')).toBe(false)
  })

  it('is true for anything else', () => {
    expect(isExternalCateringRecipient('info@ashs-plek.nl')).toBe(true)
  })
})
