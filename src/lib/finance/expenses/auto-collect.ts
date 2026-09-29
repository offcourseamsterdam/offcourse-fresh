/**
 * Senders whose invoices are auto-debited (automatische incasso). Beer flags a
 * sender once from the inbox card; ingest-email.ts then treats every later mail
 * from that address as auto-collected, so no Revolut payment is offered for it.
 * Keyed by lowercase sender e-mail (see migration 167).
 */
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

const norm = (email: string) => email.trim().toLowerCase()

export async function isAutoCollectSender(supabase: Admin, email: string | null | undefined): Promise<boolean> {
  if (!email) return false
  const { data } = await supabase.from('finance_auto_collect_senders').select('email').eq('email', norm(email)).maybeSingle()
  return !!data
}

export async function setAutoCollectSender(supabase: Admin, email: string, enabled: boolean): Promise<void> {
  const { error } = enabled
    ? await supabase.from('finance_auto_collect_senders').upsert({ email: norm(email) })
    : await supabase.from('finance_auto_collect_senders').delete().eq('email', norm(email))
  if (error) throw new Error(error.message)
}
