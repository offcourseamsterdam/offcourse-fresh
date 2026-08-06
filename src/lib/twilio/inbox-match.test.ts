import { describe, it, expect, beforeEach } from 'vitest'
import { findOrCreateContactByPhone, findOrCreateConversationByContact } from './inbox-match'

const state = {
  contacts: [] as { id: string; name: string; phone_e164: string }[],
  conversations: [] as { id: string; channel: string; contact_id: string; unread_count: number }[],
  nextId: 1,
}

function freshId(prefix: string): string {
  return `${prefix}-${state.nextId++}`
}

function fakeSupabase({ simulateInsertRace = false }: { simulateInsertRace?: boolean } = {}) {
  return {
    from: (table: string) => {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: (_col: string, phone: string) => ({
              maybeSingle: async () => ({ data: state.contacts.find(c => c.phone_e164 === phone) ?? null }),
            }),
          }),
          insert: (row: { name: string; phone_e164: string }) => ({
            select: () => ({
              single: async () => {
                const created = { id: freshId('contact'), ...row }
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
      }
      if (table === 'conversations') {
        return {
          select: () => ({
            eq: (col1: string, val1: string) => ({
              eq: (col2: string, val2: string) => ({
                maybeSingle: async () => ({
                  data:
                    state.conversations.find(c => (c as never as Record<string, unknown>)[col1] === val1 && (c as never as Record<string, unknown>)[col2] === val2) ??
                    null,
                }),
              }),
            }),
          }),
          insert: (row: { channel: string; contact_id: string }) => ({
            select: () => ({
              single: async () => {
                if (simulateInsertRace) {
                  // A concurrent request already won the race and inserted
                  // this exact row between our SELECT and INSERT — the real
                  // partial unique index (migration 118) is what makes
                  // Postgres actually reject this insert with 23505.
                  const winner = { id: freshId('conv'), unread_count: 0, ...row }
                  state.conversations.push(winner)
                  return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
                }
                const created = { id: freshId('conv'), unread_count: 0, ...row }
                state.conversations.push(created)
                return { data: created, error: null }
              },
            }),
          }),
        }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }
}

beforeEach(() => {
  state.contacts.length = 0
  state.conversations.length = 0
  state.nextId = 1
})

describe('findOrCreateContactByPhone', () => {
  it('creates a new contact with the given name', async () => {
    const supabase = fakeSupabase()
    const id = await findOrCreateContactByPhone(supabase as never, '+31612345678', 'Susanne Hartmann')
    expect(state.contacts).toEqual([{ id, name: 'Susanne Hartmann', phone_e164: '+31612345678' }])
  })

  it('falls back to the phone number itself as the placeholder name when none is given', async () => {
    const supabase = fakeSupabase()
    await findOrCreateContactByPhone(supabase as never, '+31612345678', '')
    expect(state.contacts[0].name).toBe('+31612345678')
  })

  it('reuses the existing contact for a returning phone number', async () => {
    const supabase = fakeSupabase()
    const id1 = await findOrCreateContactByPhone(supabase as never, '+31612345678', 'Susanne Hartmann')
    const id2 = await findOrCreateContactByPhone(supabase as never, '+31612345678', 'Susanne Hartmann')
    expect(id1).toBe(id2)
    expect(state.contacts).toHaveLength(1)
  })

  it('never overwrites a contact name that is already set — a noisy WhatsApp ProfileName or Voice CNAM lookup must not clobber it', async () => {
    const supabase = fakeSupabase()
    await findOrCreateContactByPhone(supabase as never, '+31612345678', 'Susanne Hartmann')
    await findOrCreateContactByPhone(supabase as never, '+31612345678', 'WIRELESS CALLER')
    expect(state.contacts[0].name).toBe('Susanne Hartmann')
  })

  it('fills in a name once one arrives, for a contact that only had its phone number as a placeholder name', async () => {
    const supabase = fakeSupabase()
    await findOrCreateContactByPhone(supabase as never, '+31612345678', '')
    await findOrCreateContactByPhone(supabase as never, '+31612345678', 'Susanne Hartmann')
    expect(state.contacts[0].name).toBe('Susanne Hartmann')
  })
})

describe('findOrCreateConversationByContact', () => {
  it('creates a new conversation for a first-time contact on a channel', async () => {
    const supabase = fakeSupabase()
    const { id, unreadCount } = await findOrCreateConversationByContact(supabase as never, 'contact-1', 'whatsapp')
    expect(unreadCount).toBe(0)
    expect(state.conversations).toEqual([{ id, channel: 'whatsapp', contact_id: 'contact-1', unread_count: 0 }])
  })

  it('reuses the existing conversation for the same contact + channel', async () => {
    const supabase = fakeSupabase()
    const first = await findOrCreateConversationByContact(supabase as never, 'contact-1', 'whatsapp')
    const second = await findOrCreateConversationByContact(supabase as never, 'contact-1', 'whatsapp')
    expect(second.id).toBe(first.id)
    expect(state.conversations).toHaveLength(1)
  })

  it('keeps voice and whatsapp as separate conversations for the same contact', async () => {
    const supabase = fakeSupabase()
    const whatsapp = await findOrCreateConversationByContact(supabase as never, 'contact-1', 'whatsapp')
    const voice = await findOrCreateConversationByContact(supabase as never, 'contact-1', 'voice')
    expect(whatsapp.id).not.toBe(voice.id)
  })

  it('recovers from a concurrent-insert race instead of throwing — fetches the row the other request created', async () => {
    const supabase = fakeSupabase({ simulateInsertRace: true })
    const result = await findOrCreateConversationByContact(supabase as never, 'contact-1', 'whatsapp')
    expect(result.id).toBe(state.conversations[0].id)
    expect(state.conversations).toHaveLength(1)
  })
})
