import { describe, it, expect } from 'vitest'
import { deriveStatus, MATCH_AUTO_THRESHOLD, MATCH_PARTIAL_THRESHOLD, type StatusInputs } from './status'

function inputs(over: Partial<StatusInputs> = {}): StatusInputs {
  return {
    ignored: false,
    hasPayment: false,
    hasCostDocument: false,
    hasOrderConfirmationOnly: false,
    matchConfidence: null,
    vatResolved: false,
    vatConflict: false,
    flaggedForReview: false,
    provenanceTrusted: true,
    sentToSnelstartAt: null,
    bookedAt: null,
    ...over,
  }
}

describe('deriveStatus — the PRD situations', () => {
  it('A: a card payment with no document yet is waiting for an invoice', () => {
    expect(deriveStatus(inputs({ hasPayment: true }))).toBe('waiting_for_invoice')
  })

  it('a payment with only an order confirmation is partially matched — the order is proven, the cost is not', () => {
    expect(deriveStatus(inputs({ hasPayment: true, hasOrderConfirmationOnly: true }))).toBe('partially_matched')
  })

  it('C: an invoice (or receipt) with no payment yet is waiting for payment', () => {
    expect(deriveStatus(inputs({ hasCostDocument: true }))).toBe('waiting_for_payment')
    expect(deriveStatus(inputs({ hasOrderConfirmationOnly: true }))).toBe('waiting_for_payment')
  })

  it('B/full match: payment + cost document at or above the auto threshold is matched, ready once VAT is resolved', () => {
    expect(deriveStatus(inputs({ hasPayment: true, hasCostDocument: true, matchConfidence: MATCH_AUTO_THRESHOLD }))).toBe('matched')
    expect(deriveStatus(inputs({ hasPayment: true, hasCostDocument: true, matchConfidence: 0.95, vatResolved: true }))).toBe('ready_for_snelstart')
  })

  it('a score between the partial and auto thresholds needs one click to confirm', () => {
    expect(deriveStatus(inputs({ hasPayment: true, hasCostDocument: true, matchConfidence: MATCH_PARTIAL_THRESHOLD }))).toBe('partially_matched')
    expect(deriveStatus(inputs({ hasPayment: true, hasCostDocument: true, matchConfidence: 0.89 }))).toBe('partially_matched')
  })

  it('both present but never scored is partially matched, never silently matched', () => {
    expect(deriveStatus(inputs({ hasPayment: true, hasCostDocument: true, matchConfidence: null, vatResolved: true }))).toBe('partially_matched')
  })
})

describe('deriveStatus — precedence', () => {
  it('a VAT conflict overrides an otherwise perfect match (PRD §8: never overwrite a difference silently)', () => {
    expect(deriveStatus(inputs({ hasPayment: true, hasCostDocument: true, matchConfidence: 1, vatResolved: true, vatConflict: true }))).toBe('needs_review')
  })

  it('a review flag (duplicate suspicion, near-tie) overrides the combos', () => {
    expect(deriveStatus(inputs({ hasPayment: true, flaggedForReview: true }))).toBe('needs_review')
  })

  it('ignored beats every open state but never a sent/booked one', () => {
    expect(deriveStatus(inputs({ ignored: true, hasPayment: true }))).toBe('ignored')
    expect(deriveStatus(inputs({ ignored: true, sentToSnelstartAt: '2026-09-05T10:00:00Z' }))).toBe('sent_to_snelstart')
  })

  it('sent and booked are terminal, regardless of anything else', () => {
    const messy = inputs({ vatConflict: true, flaggedForReview: true, ignored: true })
    expect(deriveStatus({ ...messy, sentToSnelstartAt: '2026-09-05T10:00:00Z' })).toBe('sent_to_snelstart')
    expect(deriveStatus({ ...messy, sentToSnelstartAt: '2026-09-05T10:00:00Z', bookedAt: '2026-09-06T10:00:00Z' })).toBe('booked')
  })

  it('is total: every boolean combination yields a valid status', () => {
    const bools = [false, true]
    const statuses = new Set<string>()
    for (const ignored of bools) for (const hasPayment of bools) for (const hasCostDocument of bools) for (const hasOrderConfirmationOnly of bools)
      for (const vatResolved of bools) for (const vatConflict of bools) for (const flaggedForReview of bools)
        for (const matchConfidence of [null, 0.3, 0.7, 0.95])
          statuses.add(deriveStatus(inputs({ ignored, hasPayment, hasCostDocument, hasOrderConfirmationOnly, vatResolved, vatConflict, flaggedForReview, matchConfidence })))
    expect([...statuses].every(s => typeof s === 'string' && s.length > 0)).toBe(true)
    expect(statuses.has('sent_to_snelstart')).toBe(false) // only reachable via sentToSnelstartAt
  })
})

describe('provenance gate (review finding: LLM-read mail must never drive an outbound send alone)', () => {
  const both = { hasPayment: true, hasCostDocument: true, matchConfidence: 0.95, vatResolved: true }
  it('a well-scoring but untrusted document parks at matched, not ready_for_snelstart', () => {
    expect(deriveStatus(inputs({ ...both, provenanceTrusted: false }))).toBe('matched')
    expect(deriveStatus(inputs({ ...both, provenanceTrusted: true }))).toBe('ready_for_snelstart')
  })
  it('provenance changes nothing below the auto threshold or without VAT', () => {
    expect(deriveStatus(inputs({ ...both, matchConfidence: 0.7, provenanceTrusted: false }))).toBe('partially_matched')
    expect(deriveStatus(inputs({ ...both, vatResolved: false, provenanceTrusted: true }))).toBe('matched')
  })
})
