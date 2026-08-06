import type { createAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * Shared by every channel that identifies a contact by a single unique
 * column (Gmail by email, WhatsApp/Voice by phone_e164) — NOT by webchat's
 * chat/start/route.ts, which has deliberately different semantics ("people
 * correct their own name; the newest version wins" — a visitor is typing
 * their own name into a form, unlike the third-party signals below).
 *
 * Only fills in a name the contact never had — never overwrites one that's
 * already set. A third-party display name (a Gmail From-header name, a
 * WhatsApp ProfileName, a Voice CNAM caller-ID lookup) can be wrong, generic,
 * or simply change over time; a name that's already correct because it was
 * set via a booking or another channel must never be clobbered by it.
 */
export async function findOrCreateContactByField(
  supabase: SupabaseAdmin,
  field: 'email' | 'phone_e164',
  value: string,
  name: string,
): Promise<string> {
  const { data: existing } = await supabase.from('contacts').select('id, name').eq(field, value).maybeSingle()
  if (existing) {
    if (name && existing.name === value) {
      await supabase.from('contacts').update({ name }).eq('id', existing.id)
    }
    return existing.id
  }

  const { data: created, error } = await supabase
    .from('contacts')
    .insert({ name: name || value, [field]: value })
    .select('id')
    .single()
  if (error || !created) throw new Error(`Could not create contact for ${value}: ${error?.message}`)
  return created.id
}
