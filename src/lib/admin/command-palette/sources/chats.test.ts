import { describe, it, expect } from 'vitest'
import { chatsSource } from './chats'
import { fakeSupabase } from './test-helpers'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asSupabase = (s: unknown) => s as any

const contacts = [
  { id: 'contact-1', name: 'Diana de Vries', email: 'diana@example.com', phone_e164: '+31600000001' },
  { id: 'contact-2', name: 'Someone Else', email: 'else@example.com', phone_e164: '+31600000002' },
]

const conversations = [
  { id: 'conv-1', contact_id: 'contact-1', subject: null, ota_guest_name: null, source_category: 'operations', last_message_at: '2026-09-10' },
  { id: 'conv-2', contact_id: 'contact-2', subject: 'Refund request', ota_guest_name: null, source_category: 'finance', last_message_at: '2026-09-11' },
  { id: 'conv-3', contact_id: null, subject: null, ota_guest_name: 'Withlocals guest — Viator mix-up', source_category: 'operations', last_message_at: '2026-09-12' },
]

describe('chatsSource', () => {
  it('finds a conversation via a contact name match (not a column on conversations itself)', async () => {
    const supabase = fakeSupabase({ contacts, conversations })
    const results = await chatsSource.search(asSupabase(supabase), 'diana')
    expect(results.map(r => r.id)).toContain('chat:conv-1')
  })
  it('finds a conversation by its own subject text', async () => {
    const supabase = fakeSupabase({ contacts, conversations })
    const results = await chatsSource.search(asSupabase(supabase), 'refund')
    expect(results.map(r => r.id)).toContain('chat:conv-2')
  })
  it('finds a conversation by ota_guest_name substring', async () => {
    const supabase = fakeSupabase({ contacts, conversations })
    const results = await chatsSource.search(asSupabase(supabase), 'mix-up')
    expect(results.map(r => r.id)).toContain('chat:conv-3')
  })
  it('routes a finance-scoped conversation to the finance inbox link', async () => {
    const supabase = fakeSupabase({ contacts, conversations })
    const results = await chatsSource.search(asSupabase(supabase), 'refund')
    expect(results[0].href).toBe('/admin/finance/inbox?c=conv-2')
  })
  it('routes an operations-scoped conversation to the regular inbox link', async () => {
    const supabase = fakeSupabase({ contacts, conversations })
    const results = await chatsSource.search(asSupabase(supabase), 'diana')
    expect(results[0].href).toBe('/admin/inbox?c=conv-1')
  })
  it('does not crash and returns no contact-linked results when no contact matches', async () => {
    const supabase = fakeSupabase({ contacts, conversations })
    const results = await chatsSource.search(asSupabase(supabase), 'zzzznotreal')
    expect(results).toEqual([])
  })
  it('returns nothing for an empty query without hitting the database', async () => {
    const supabase = fakeSupabase({ contacts, conversations })
    const results = await chatsSource.search(asSupabase(supabase), '  ')
    expect(results).toEqual([])
  })
  it('returns nothing (not every conversation) for a query that is only special characters', async () => {
    // ",," escapes down to an empty ilike pattern — must not fall back to "%%" (match everything).
    const supabase = fakeSupabase({ contacts, conversations })
    const results = await chatsSource.search(asSupabase(supabase), ',,')
    expect(results).toEqual([])
  })
  it('does not duplicate a conversation matched by both its own text and its contact', async () => {
    const bothMatch = [{ ...conversations[0], subject: 'diana follow-up' }] // matches "diana" via subject AND via contact-1
    const supabase = fakeSupabase({ contacts, conversations: bothMatch })
    const results = await chatsSource.search(asSupabase(supabase), 'diana')
    const ids = results.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
