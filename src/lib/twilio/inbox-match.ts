/**
 * Phone-based contact/conversation matching, shared by every Twilio channel
 * (WhatsApp, Voice) — unlike Gmail's thread-based matching, phone channels
 * have no "thread" concept, so it's always one continuous conversation per
 * (contact, channel).
 */
import type { createAdminClient } from '@/lib/supabase/admin'
import { findOrCreateContactByField } from '@/lib/contacts/find-or-create'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/** Thin, phone-specific name so call sites don't need to know the underlying column is phone_e164. */
export async function findOrCreateContactByPhone(supabase: SupabaseAdmin, phone: string, name: string): Promise<string> {
  return findOrCreateContactByField(supabase, 'phone_e164', phone, name)
}

async function lookupConversationByContact(
  supabase: SupabaseAdmin,
  contactId: string,
  channel: 'whatsapp' | 'voice',
): Promise<{ id: string; unreadCount: number } | null> {
  const { data } = await supabase
    .from('conversations')
    .select('id, unread_count')
    .eq('channel', channel)
    .eq('contact_id', contactId)
    .maybeSingle()
  return data ? { id: data.id, unreadCount: data.unread_count ?? 0 } : null
}

export async function findOrCreateConversationByContact(
  supabase: SupabaseAdmin,
  contactId: string,
  channel: 'whatsapp' | 'voice',
): Promise<{ id: string; unreadCount: number }> {
  const existing = await lookupConversationByContact(supabase, contactId, channel)
  if (existing) return existing

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({ channel, contact_id: contactId })
    .select('id')
    .single()
  if (error) {
    // 23505 = another near-simultaneous webhook delivery for this same
    // contact+channel (a Twilio retry, or an inbound message racing an
    // outbound call) won the race and inserted first — backed by a partial
    // unique index (migration 118). Not a real failure: the row it created
    // is the one we want, so fetch and use that instead of erroring out.
    if (error.code === '23505') {
      const winner = await lookupConversationByContact(supabase, contactId, channel)
      if (winner) return winner
    }
    throw new Error(`Could not create ${channel} conversation for contact ${contactId}: ${error.message}`)
  }
  if (!created) throw new Error(`Could not create ${channel} conversation for contact ${contactId}: no row returned`)
  return { id: created.id, unreadCount: 0 }
}
