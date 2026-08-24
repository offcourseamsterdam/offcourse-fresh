/**
 * Resolves who a catering supplier order email should go to for a given
 * listing. Most listings share one caterer (the site-wide default); a listing
 * can override this (e.g. an external chef running their own catering for
 * that one cruise — see cruise_listings.catering_email_recipient).
 *
 * Shared by sendCateringOrderEmailForBooking (checkout-time order) and the
 * extras pre-order upsell route (post-booking order) so both paths route to
 * the same place instead of drifting.
 */

import { createAdminClient } from '@/lib/supabase/admin'

// Read fresh per call, not cached at module load — env vars are read this way
// everywhere else in this codebase, and a module-level constant would also
// break test isolation (vi.stubEnv per-test wouldn't take effect after the
// first import).
function defaultRecipient(): string {
  return process.env.CATERING_EMAIL_RECIPIENT ?? 'info@offcourseamsterdam.com'
}

export async function resolveCateringEmailRecipient(listingId: string | null): Promise<string> {
  if (!listingId) return defaultRecipient()
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('cruise_listings')
    .select('catering_email_recipient')
    .eq('id', listingId)
    .maybeSingle()
  return data?.catering_email_recipient || defaultRecipient()
}

/** True when a listing has its own caterer, not the site-wide default. */
export function isExternalCateringRecipient(recipient: string): boolean {
  return recipient !== defaultRecipient()
}
