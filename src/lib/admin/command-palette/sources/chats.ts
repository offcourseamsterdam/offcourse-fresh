import { ilikePattern } from '../ilike'
import type { PaletteItem } from '../types'
import type { AdminSupabase, SearchSource } from './types'

const CONVERSATION_TEXT_COLUMNS = ['subject', 'ota_guest_name', 'ota_booking_ref', 'ai_summary']
const CONTACT_TEXT_COLUMNS = ['name', 'email', 'phone_e164']
const LIMIT = 6

function toItem(row: Record<string, unknown>): PaletteItem {
  const title = String(row.subject ?? row.ota_guest_name ?? 'Conversation')
  const subtitle = [row.ota_source, row.ai_summary].filter(Boolean).join(' · ')
  // The finance inbox and the operations inbox are the same UI (InboxShell) over
  // the same `conversations` table, split only by `source_category` — see
  // src/app/[locale]/admin/inbox/InboxShell.tsx's doc comment.
  const base = row.source_category === 'finance' ? '/admin/finance/inbox' : '/admin/inbox'
  return {
    id: `chat:${row.id}`,
    kind: 'record',
    group: 'Chats',
    title,
    subtitle: subtitle || undefined,
    href: `${base}?c=${row.id}`,
  }
}

export const chatsSource: SearchSource = {
  group: 'Chats',
  scope: 'chats',
  async search(supabase: AdminSupabase, query: string): Promise<PaletteItem[]> {
    const q = query.trim()
    if (!q) return []
    const pattern = ilikePattern(q)
    // A query that's only special characters (",," "((") escapes down to
    // nothing — ilikePattern returns null rather than the always-matching
    // "%%", which would otherwise match every conversation.
    if (!pattern) return []

    // A contact's name/email/phone doesn't live on `conversations` itself —
    // find matching contacts, and match conversations by their own text
    // columns, in parallel — neither depends on the other's result.
    const [{ data: contactRows }, { data: textRows, error: textError }] = await Promise.all([
      supabase
        .from('contacts')
        .select('id')
        .or(CONTACT_TEXT_COLUMNS.map(c => `${c}.ilike.${pattern}`).join(','))
        .limit(20),
      supabase
        .from('conversations')
        .select('*')
        .or(CONVERSATION_TEXT_COLUMNS.map(c => `${c}.ilike.${pattern}`).join(','))
        .order('last_message_at', { ascending: false })
        .limit(LIMIT),
    ])

    // Only NOW do we know which contacts matched, so a conversation lookup by
    // contact_id is necessarily a second round trip — but a real parameterized
    // `.in()` call, never a hand-built `.or()` string: contact ids are trusted
    // UUIDs today, but interpolating IDs into a filter string is exactly the
    // pattern src/app/api/admin/inbox/conversations/route.ts's own comment
    // warns against, for any id that might not always be.
    const contactIds = (contactRows ?? []).map(r => String((r as { id: string }).id))
    const contactRowsResult = contactIds.length > 0
      ? await supabase
          .from('conversations')
          .select('*')
          .in('contact_id', contactIds)
          .order('last_message_at', { ascending: false })
          .limit(LIMIT)
      : { data: [] as Record<string, unknown>[], error: null }

    if (textError) return []
    const rows = [...(textRows ?? []), ...(contactRowsResult.data ?? [])]
    const byId = new Map<string, Record<string, unknown>>()
    for (const row of rows as Record<string, unknown>[]) byId.set(String(row.id), row)

    return [...byId.values()].slice(0, LIMIT).map(toItem)
  },
}
