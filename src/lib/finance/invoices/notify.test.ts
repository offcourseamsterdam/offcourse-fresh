import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildInvoiceArrivedText, financeInboxUrl } from './notify'

describe('financeInboxUrl', () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL
  beforeEach(() => { process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test' })
  afterEach(() => { process.env.NEXT_PUBLIC_SITE_URL = original })

  it('deep-links into the separate Facturen inbox, not the operations inbox', () => {
    expect(financeInboxUrl('conv-1')).toBe('https://example.test/en/admin/finance/inbox?c=conv-1')
  })
})

describe('buildInvoiceArrivedText', () => {
  // beforeEach, not a bare call in the describe body: a bare call runs once
  // during collection, before the sibling describe's own afterEach (which
  // resets this same env var) runs during the test phase — it was clobbered
  // by the time these tests actually executed.
  beforeEach(() => { process.env.NEXT_PUBLIC_SITE_URL = 'https://example.test' })

  it('a clean invoice reads as ready to pay with who, how much and which file', () => {
    const text = buildInvoiceArrivedText({ conversationId: 'c1', supplierName: 'Mare', filename: 'factuur-aug.pdf', status: 'ready', amountCents: 15000, checks: [{ key: 'amount', ok: true, detail: '' }] })
    expect(text).toContain('klaar om te betalen')
    expect(text).toContain('Mare · €150,00 · factuur-aug.pdf')
    expect(text).not.toContain('❌')
    expect(text).toContain('<https://example.test/en/admin/finance/inbox?c=c1|Open in Facturen →>')
  })

  it('a needs_review invoice lists exactly the checks that failed, in Dutch', () => {
    const text = buildInvoiceArrivedText({
      conversationId: 'c1', supplierName: 'Mare', filename: 'f.pdf', status: 'needs_review', amountCents: 15000,
      checks: [{ key: 'amount', ok: false, detail: '' }, { key: 'date', ok: false, detail: '' }, { key: 'skipper', ok: true, detail: '' }],
    })
    expect(text).toContain('controleren')
    expect(text).toContain('❌ bedrag, datum')
    expect(text).not.toContain('schipper')
  })

  it('an unknown sender and no amount still produce a readable line', () => {
    const text = buildInvoiceArrivedText({ conversationId: 'c1', supplierName: null, filename: 'scan.pdf', status: 'failed', amountCents: null, checks: [] })
    expect(text).toContain('verwerken mislukt')
    expect(text).toContain('onbekende afzender · scan.pdf')
  })
})
