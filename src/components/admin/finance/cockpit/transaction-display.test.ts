import { describe, it, expect } from 'vitest'
import { transactionLabel, transactionBadge, classificationLabel, isIncoming } from './transaction-display'

describe('transactionLabel', () => {
  it('prefers the description', () => {
    expect(transactionLabel({ description: 'Ligplaats sept', merchant: { name: 'Shop' }, counterparty: { name: 'Bob' }, reference: 'REF' })).toBe('Ligplaats sept')
  })
  it('falls back to merchant, then counterparty, then reference', () => {
    expect(transactionLabel({ description: null, merchant: { name: 'Albert Heijn' }, counterparty: { name: 'Bob' }, reference: 'REF' })).toBe('Albert Heijn')
    expect(transactionLabel({ description: '  ', merchant: null, counterparty: { name: 'Bob' }, reference: 'REF' })).toBe('Bob')
    expect(transactionLabel({ description: null, merchant: { name: '' }, counterparty: {}, reference: 'REF-1' })).toBe('REF-1')
  })
  it('never returns an empty string', () => {
    expect(transactionLabel({ description: null, merchant: null, counterparty: null, reference: null })).toBe('Transactie')
  })
  it('ignores non-string name fields', () => {
    expect(transactionLabel({ description: null, merchant: { name: 42 }, counterparty: null, reference: 'x' })).toBe('x')
  })
})

describe('transactionBadge', () => {
  it('marks created/pending as in behandeling', () => {
    expect(transactionBadge('created')).toEqual({ tone: 'pending', label: 'in behandeling' })
    expect(transactionBadge('pending')).toEqual({ tone: 'pending', label: 'in behandeling' })
  })
  it('marks declined/failed/reverted as failed', () => {
    expect(transactionBadge('declined')?.tone).toBe('failed')
    expect(transactionBadge('failed')?.tone).toBe('failed')
    expect(transactionBadge('reverted')?.tone).toBe('failed')
  })
  it('shows nothing for completed or unknown states', () => {
    expect(transactionBadge('completed')).toBeNull()
    expect(transactionBadge('whatever')).toBeNull()
  })
})

describe('classificationLabel', () => {
  it('joins category and subcategory', () => {
    expect(classificationLabel({ category: 'Boot', subcategory: 'Ligplaats' })).toBe('Boot · Ligplaats')
    expect(classificationLabel({ category: 'Boot', subcategory: null })).toBe('Boot')
  })
  it('returns null when unclassified', () => {
    expect(classificationLabel({ category: null, subcategory: 'x' })).toBeNull()
    expect(classificationLabel({ category: ' ', subcategory: null })).toBeNull()
  })
})

describe('isIncoming', () => {
  it('is true only for positive amounts', () => {
    expect(isIncoming({ amount_cents: 1 })).toBe(true)
    expect(isIncoming({ amount_cents: 0 })).toBe(false)
    expect(isIncoming({ amount_cents: -500 })).toBe(false)
  })
})
