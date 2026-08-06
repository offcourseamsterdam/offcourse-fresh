import { describe, it, expect, beforeEach } from 'vitest'
import { findOrCreateContactByField } from './find-or-create'

const state = {
  contacts: [] as { id: string; name: string; email?: string; phone_e164?: string }[],
  nextId: 1,
}

function fakeSupabase() {
  return {
    from: (table: string) => {
      if (table !== 'contacts') throw new Error(`unexpected table "${table}"`)
      return {
        select: () => ({
          eq: (field: string, value: string) => ({
            maybeSingle: async () => ({ data: state.contacts.find(c => (c as never as Record<string, unknown>)[field] === value) ?? null }),
          }),
        }),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const created = { id: `contact-${state.nextId++}`, ...row } as never as { id: string; name: string }
              state.contacts.push(created)
              return { data: created, error: null }
            },
          }),
        }),
        update: (patch: Partial<{ name: string }>) => ({
          eq: async (_col: string, id: string) => {
            const c = state.contacts.find(c => c.id === id)
            if (c) Object.assign(c, patch)
            return { data: null, error: null }
          },
        }),
      }
    },
  }
}

beforeEach(() => {
  state.contacts.length = 0
  state.nextId = 1
})

describe('findOrCreateContactByField', () => {
  it('creates a new contact keyed on the given field', async () => {
    const supabase = fakeSupabase()
    const id = await findOrCreateContactByField(supabase as never, 'email', 'sarah@example.com', 'Sarah Mitchell')
    expect(state.contacts).toEqual([{ id, name: 'Sarah Mitchell', email: 'sarah@example.com' }])
  })

  it('falls back to the field value itself as a placeholder name when none is given', async () => {
    const supabase = fakeSupabase()
    await findOrCreateContactByField(supabase as never, 'phone_e164', '+31612345678', '')
    expect(state.contacts[0].name).toBe('+31612345678')
  })

  it('reuses the existing contact for the same field value', async () => {
    const supabase = fakeSupabase()
    const id1 = await findOrCreateContactByField(supabase as never, 'email', 'sarah@example.com', 'Sarah Mitchell')
    const id2 = await findOrCreateContactByField(supabase as never, 'email', 'sarah@example.com', 'Sarah Mitchell')
    expect(id1).toBe(id2)
    expect(state.contacts).toHaveLength(1)
  })

  it('never overwrites a name that is already set', async () => {
    const supabase = fakeSupabase()
    await findOrCreateContactByField(supabase as never, 'phone_e164', '+31612345678', 'Susanne Hartmann')
    await findOrCreateContactByField(supabase as never, 'phone_e164', '+31612345678', 'WIRELESS CALLER')
    expect(state.contacts[0].name).toBe('Susanne Hartmann')
  })

  it('fills in a name once one arrives, for a contact that only had the field value itself as a placeholder name', async () => {
    const supabase = fakeSupabase()
    await findOrCreateContactByField(supabase as never, 'email', 'sarah@example.com', '')
    await findOrCreateContactByField(supabase as never, 'email', 'sarah@example.com', 'Sarah Mitchell')
    expect(state.contacts[0].name).toBe('Sarah Mitchell')
  })
})
