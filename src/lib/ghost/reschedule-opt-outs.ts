import { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Guest-level permanent opt-out from reschedule asks (Beer, 2026-08-23: "one
 * decline, never ask that guest again"). Distinct from every other guard in
 * this area (sequential-per-day, minimum notice) — those are about WHEN an
 * ask can go out; this is about WHO should never be asked again, at all,
 * across every future booking and every move type.
 *
 * Matched by email OR phone since there is no guest/customer identity table
 * — a booking only ever carries contact fields directly.
 */
export async function recordOptOut(
  supabase: AdminClient,
  opts: { email: string | null; phone: string | null; bookingId: string | null; proposalId: string | null },
): Promise<void> {
  if (!opts.email && !opts.phone) return
  await supabase.from('reschedule_opt_outs').insert({
    email: opts.email,
    phone: opts.phone,
    booking_id: opts.bookingId,
    proposal_id: opts.proposalId,
  })
}

/**
 * True when this exact email OR phone has ever declined a reschedule ask
 * before. Two separate .eq() lookups rather than a single .or() filter — a
 * raw PostgREST .or() string built from guest-supplied contact values would
 * need careful escaping (commas/parens are filter syntax); plain .eq() has
 * no such risk.
 */
export async function isOptedOut(
  supabase: AdminClient,
  contact: { email: string | null | undefined; phone: string | null | undefined },
): Promise<boolean> {
  if (contact.email) {
    const { data } = await supabase.from('reschedule_opt_outs').select('id').eq('email', contact.email).limit(1)
    if ((data?.length ?? 0) > 0) return true
  }
  if (contact.phone) {
    const { data } = await supabase.from('reschedule_opt_outs').select('id').eq('phone', contact.phone).limit(1)
    if ((data?.length ?? 0) > 0) return true
  }
  return false
}
