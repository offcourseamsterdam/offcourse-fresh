import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidMoveToken } from '@/lib/ops/move-token'
import MoveResponseClient from './MoveResponseClient'

// No cache — a rotated GUEST_MOVE_TOKEN_SECRET must kill open links instantly,
// and the page must always show the live request status (answered / expired).
export const revalidate = 0

interface Props {
  params: Promise<{ locale: string; id: string; token: string }>
}

/**
 * The guest's personal response page for a time-change request — reached from
 * the button/link in their SMS or email. Token-gated (HMAC of the proposal
 * id), no login. Three taps: yes / let me check / keep my time. Answering
 * never rebooks anything by itself — the team performs the actual change.
 */
export default async function GuestMovePage({ params }: Props) {
  const { locale, id, token } = await params
  if (!isValidMoveToken(id, token)) notFound()

  const supabase = createAdminClient()
  const { data: p } = await supabase
    .from('agent_proposals')
    .select('id, kind, status, payload, outcome')
    .eq('id', id)
    .single()
  if (!p || p.kind !== 'guest_move_request') notFound()

  const payload = p.payload as {
    guest_name?: string | null
    cruise_title?: string | null
    target_date?: string
    guest_count?: number | null
    boat?: string
    current_start_at?: string
    proposed_start_at?: string
    total_cents?: number | null
    incentive?: string
  }
  const outcome = (p.outcome ?? {}) as { guest_response?: string }

  return (
    <MoveResponseClient
      locale={locale}
      proposalId={id}
      token={token}
      offer={{
        guestName: payload.guest_name ?? null,
        cruiseTitle: payload.cruise_title ?? null,
        date: payload.target_date ?? null,
        guestCount: payload.guest_count ?? null,
        boat: payload.boat ?? null,
        currentStartAt: payload.current_start_at ?? null,
        proposedStartAt: payload.proposed_start_at ?? null,
        totalCents: payload.total_cents ?? null,
        incentive: payload.incentive ?? null,
      }}
      initialResponse={typeof outcome.guest_response === 'string' ? outcome.guest_response : null}
      expired={p.status === 'expired'}
      sent={p.status === 'approved' || p.status === 'executed'}
    />
  )
}
