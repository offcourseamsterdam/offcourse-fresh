import type { createAdminClient } from '@/lib/supabase/admin'

type SupabaseAdmin = ReturnType<typeof createAdminClient>

/**
 * Marks a conversation resolved — nothing left needing a human decision, so
 * it drops out of the inbox's "Open" list. One place for this one-liner
 * instead of three (the `own_channel`-matched OTA branch, the GYG
 * review-notification email path, and the review-assign route all reach
 * this same conclusion independently).
 */
export async function resolveConversation(supabase: SupabaseAdmin, conversationId: string): Promise<void> {
  await supabase.from('conversations').update({ status: 'resolved' }).eq('id', conversationId)
}
