import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Called from the Stripe webhook (additively — see that file's comment)
 * right after a FareHarbor booking is successfully created for a
 * PaymentIntent. Flips the matching ACP checkout session from
 * `complete_in_progress` to `completed` so an agent polling
 * GET .../checkout_sessions/{id} sees the true final state.
 *
 * A no-op for every non-ACP PaymentIntent — those simply have no
 * `acp_checkout_session_id` in their metadata, so this returns immediately.
 * Never throws: a failure here must not affect the booking itself, which
 * already succeeded — it would just leave the ACP session polling stale,
 * logged for follow-up.
 */
export async function markAcpSessionCompleted(
  acpCheckoutSessionId: string | undefined,
  bookingId: string | null
): Promise<void> {
  if (!acpCheckoutSessionId) return

  try {
    const supabase = createAdminClient()
    const { error } = await supabase
      .from('acp_checkout_sessions')
      .update({ status: 'completed', booking_id: bookingId, updated_at: new Date().toISOString() })
      .eq('id', acpCheckoutSessionId)

    if (error) {
      console.error('[acp] failed to flip session to completed (booking succeeded regardless):', acpCheckoutSessionId, error.message)
    }
  } catch (err) {
    console.error('[acp] unexpected error flipping session to completed (booking succeeded regardless):', acpCheckoutSessionId, err)
  }
}
