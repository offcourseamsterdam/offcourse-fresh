/**
 * Direct characterization tests for `resolveAttribution` — previously covered
 * only indirectly (and incompletely) through the route-level POST tests.
 * Written alongside the fix that makes Layer 1 (cookie attribution) resolve
 * `partnerId` fresh from the campaign row via `resolveCampaignCommission`,
 * instead of trusting the cookie's own (possibly stale) `partner_id` snapshot
 * — matching Layer 2 and the Stripe webhook's already-correct behavior.
 */
import { describe, it, expect, vi } from 'vitest'

const campaignRows = vi.hoisted(() => new Map<string, Record<string, unknown> | null>())
const promoRows = vi.hoisted(() => new Map<string, Record<string, unknown> | null>())

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, val: string) => ({
          maybeSingle: async () => {
            if (table === 'campaigns') return { data: campaignRows.get(val) ?? null, error: null }
            if (table === 'promo_codes') return { data: promoRows.get(val) ?? null, error: null }
            return { data: null, error: null }
          },
        }),
      }),
    }),
  }),
}))

import { resolveAttribution } from './route'

describe('resolveAttribution', () => {
  it('Layer 1 (cookie): resolves partnerId fresh from the campaign row, not the cookie snapshot', () => {
    campaignRows.set('camp-1', { partner_id: 'partner-fresh', percentage_value: 10, investment_type: 'percentage' })
    return resolveAttribution({
      attrCookie: JSON.stringify({ campaign_id: 'camp-1', partner_id: 'partner-STALE' }),
      promoCodeId: null,
      partnerInvoiceContext: null,
      invoiceLaterContext: null,
      baseAmountCents: 10000,
    }).then(result => {
      expect(result).toEqual({
        campaignId: 'camp-1',
        partnerId: 'partner-fresh', // NOT 'partner-STALE'
        commissionAmountCents: 1000,
      })
    })
  })

  it('Layer 1: a deleted/nonexistent campaign leaves everything null (non-fatal)', async () => {
    const result = await resolveAttribution({
      attrCookie: JSON.stringify({ campaign_id: 'gone', partner_id: 'partner-1' }),
      promoCodeId: null,
      partnerInvoiceContext: null,
      invoiceLaterContext: null,
      baseAmountCents: 10000,
    })
    expect(result).toEqual({ campaignId: null, partnerId: null, commissionAmountCents: null })
  })

  it('Layer 1: malformed cookie JSON does not throw', async () => {
    const result = await resolveAttribution({
      attrCookie: 'not-json{{{',
      promoCodeId: null,
      partnerInvoiceContext: null,
      invoiceLaterContext: null,
      baseAmountCents: 10000,
    })
    expect(result).toEqual({ campaignId: null, partnerId: null, commissionAmountCents: null })
  })

  it('Layer 2: promo code with a campaign_id overrides Layer 1 cookie attribution', async () => {
    campaignRows.set('camp-cookie', { partner_id: 'partner-cookie', percentage_value: 10, investment_type: 'percentage' })
    campaignRows.set('camp-promo', { partner_id: 'partner-promo', percentage_value: 20, investment_type: 'percentage' })
    promoRows.set('promo-1', { campaign_id: 'camp-promo' })

    const result = await resolveAttribution({
      attrCookie: JSON.stringify({ campaign_id: 'camp-cookie' }),
      promoCodeId: 'promo-1',
      partnerInvoiceContext: null,
      invoiceLaterContext: null,
      baseAmountCents: 10000,
    })
    expect(result).toEqual({
      campaignId: 'camp-promo',
      partnerId: 'partner-promo',
      commissionAmountCents: 2000,
    })
  })

  it('Layer 3: partner-invoice context always wins over cookie/promo', async () => {
    campaignRows.set('camp-cookie-2', { partner_id: 'partner-cookie', percentage_value: 10, investment_type: 'percentage' })

    const result = await resolveAttribution({
      attrCookie: JSON.stringify({ campaign_id: 'camp-cookie-2' }),
      promoCodeId: null,
      partnerInvoiceContext: {
        partnerId: 'partner-invoice',
        partnerName: 'Invoice Partner',
        campaignId: 'camp-invoice',
        commissionPercent: 15,
      },
      invoiceLaterContext: null,
      baseAmountCents: 10000,
    })
    expect(result).toEqual({
      campaignId: 'camp-invoice',
      partnerId: 'partner-invoice',
      commissionAmountCents: 1500,
    })
  })

  it('Layer 4: invoice-later context always wins over everything, including partner-invoice', async () => {
    const result = await resolveAttribution({
      attrCookie: null,
      promoCodeId: null,
      partnerInvoiceContext: {
        partnerId: 'partner-invoice',
        partnerName: 'Invoice Partner',
        campaignId: 'camp-invoice',
        commissionPercent: 15,
      },
      invoiceLaterContext: {
        partnerId: 'partner-later',
        partnerName: 'Later Partner',
        commissionAmountCents: 999,
        invoiceAmountCents: 5000,
      },
      baseAmountCents: 10000,
    })
    // Layer 4 doesn't set campaignId — only partnerId + commissionAmountCents (see
    // route.ts's own comment: "No campaign lookup here" for invoice-later).
    expect(result.partnerId).toBe('partner-later')
    expect(result.commissionAmountCents).toBe(999)
  })

  it('returns all-null when nothing is provided', async () => {
    const result = await resolveAttribution({
      attrCookie: null,
      promoCodeId: null,
      partnerInvoiceContext: null,
      invoiceLaterContext: null,
      baseAmountCents: 10000,
    })
    expect(result).toEqual({ campaignId: null, partnerId: null, commissionAmountCents: null })
  })
})
