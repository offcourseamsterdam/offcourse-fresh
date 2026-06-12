import { describe, it, expect } from 'vitest'
import { buildFHBookingNote } from './build-fh-note'
import type { ExtrasLineItem } from './filter'

const food = (overrides: Partial<ExtrasLineItem> = {}): ExtrasLineItem => ({
  name: 'Fruit Platter',
  category: 'food',
  amount_cents: 6500,
  quantity: 6,
  is_per_person_pick: true,
  ...overrides,
})

const drink = (overrides: Partial<ExtrasLineItem> = {}): ExtrasLineItem => ({
  name: 'Unlimited Drinks',
  category: 'drinks',
  amount_cents: 18000,
  quantity: 12,
  is_per_person_pick: false,
  ...overrides,
})

describe('buildFHBookingNote', () => {
  it('returns null when no catering and no guest note', () => {
    expect(buildFHBookingNote(null, [])).toBeNull()
    expect(buildFHBookingNote('', [])).toBeNull()
    expect(buildFHBookingNote(undefined, [])).toBeNull()
  })

  it('returns null when only non-catering extras are present', () => {
    const other: ExtrasLineItem = { name: 'City Tax', category: 'other', amount_cents: 500, quantity: 1 }
    expect(buildFHBookingNote(null, [other])).toBeNull()
  })

  it('shows food section with items and paid status (checkout extras, no source)', () => {
    const note = buildFHBookingNote(null, [food()])!
    expect(note).toContain('Food:')
    expect(note).toContain('- Fruit Platter ×6 people — €65 (paid)')
    expect(note).toContain('Paid at booking: €65')
  })

  it('shows drink item with settle-on-day status when source is extras_upsell', () => {
    const note = buildFHBookingNote(null, [drink({ source: 'extras_upsell' })])!
    expect(note).toContain('Drinks:')
    expect(note).toContain('- Unlimited Drinks ×12 — €180 (settle on day)')
    expect(note).toContain('Settle on day: €180')
  })

  it('defaults food section to "nothing pre-ordered" when only drinks present', () => {
    const note = buildFHBookingNote(null, [drink()])!
    expect(note).toContain('Food: nothing pre-ordered')
    expect(note).toContain('Drinks:')
  })

  it('defaults drinks section to pay-per-drink when only food present', () => {
    const note = buildFHBookingNote(null, [food()])!
    expect(note).toContain('Drinks: pay per drink bar (on the day)')
  })

  it('shows both totals when mix of paid and settle-on-day catering', () => {
    const note = buildFHBookingNote(null, [food(), drink({ source: 'extras_upsell' })])!
    expect(note).toContain('Paid at booking: €65')
    expect(note).toContain('Settle on day: €180')
  })

  it('omits totals section when all amounts are zero', () => {
    const freeItem = food({ amount_cents: 0 })
    const note = buildFHBookingNote(null, [freeItem])!
    expect(note).not.toContain('Paid at booking')
    expect(note).not.toContain('Settle on day')
  })

  it('includes guest note at the bottom', () => {
    const note = buildFHBookingNote('no nuts please', [food()])!
    expect(note).toContain('Guest note: no nuts please')
    const lines = note.split('\n\n')
    expect(lines[lines.length - 1]).toBe('Guest note: no nuts please')
  })

  it('returns a note with just guest note when no catering', () => {
    const note = buildFHBookingNote('allergic to shellfish', [])!
    expect(note).not.toBeNull()
    expect(note).toContain('Food: nothing pre-ordered')
    expect(note).toContain('Drinks: pay per drink bar (on the day)')
    expect(note).toContain('Guest note: allergic to shellfish')
  })

  it('trims whitespace from guest note', () => {
    const note = buildFHBookingNote('  hello  ', [food()])!
    expect(note).toContain('Guest note: hello')
  })

  it('shows non-per-person quantity with ×N format', () => {
    const box = food({ is_per_person_pick: false, quantity: 3, name: 'Bites Box', amount_cents: 9000 })
    const note = buildFHBookingNote(null, [box])!
    expect(note).toContain('- Bites Box ×3 — €90 (paid)')
  })

  it('ignores non-catering extras when computing totals', () => {
    const cityTax: ExtrasLineItem = { name: 'City Tax', category: 'other', amount_cents: 500, quantity: 1 }
    const note = buildFHBookingNote(null, [food(), cityTax])!
    expect(note).toContain('Paid at booking: €65')
    expect(note).not.toContain('€5')
  })
})
