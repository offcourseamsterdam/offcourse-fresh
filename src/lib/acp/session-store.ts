import { randomUUID } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Json } from '@/lib/supabase/types'
import type { ResolvedCheckout } from './resolve-checkout-items'
import type { CheckoutMessage, CheckoutSessionStatus } from './types'

export interface AcpSessionRow {
  id: string
  status: CheckoutSessionStatus
  slug: string
  date: string
  time: string
  avail_pk: number | null
  line_items: unknown
  currency: string
  total_cents: number | null
  buyer: unknown
  payment_intent_id: string | null
  booking_id: string | null
  messages: unknown
  expires_at: string
}

/**
 * Real Supabase-backed store, not in-memory — create/update/complete for one
 * checkout session can each land on a different serverless instance.
 */
export async function createSession(
  checkout: ResolvedCheckout,
  status: CheckoutSessionStatus,
  messages: CheckoutMessage[] = [],
  buyer: Json | null = null
): Promise<AcpSessionRow> {
  const supabase = createAdminClient()
  const id = `cs_${randomUUID()}`

  const { data, error } = await supabase
    .from('acp_checkout_sessions')
    .insert({
      id,
      status,
      slug: checkout.slug,
      date: checkout.date,
      time: checkout.time,
      avail_pk: checkout.availPk,
      line_items: checkout.lineItems as unknown as Json,
      total_cents: checkout.totalCents,
      messages: messages as unknown as Json,
      buyer,
    })
    .select()
    .single()

  if (error || !data) throw new Error(`Failed to create ACP checkout session: ${error?.message}`)
  return data as AcpSessionRow
}

export async function getSession(id: string): Promise<AcpSessionRow | null> {
  const supabase = createAdminClient()
  const { data } = await supabase.from('acp_checkout_sessions').select('*').eq('id', id).maybeSingle()
  return (data as AcpSessionRow | null) ?? null
}

export async function updateSession(id: string, patch: Partial<AcpSessionRow>): Promise<AcpSessionRow | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('acp_checkout_sessions')
    .update({ ...patch, updated_at: new Date().toISOString() } as never)
    .eq('id', id)
    .select()
    .maybeSingle()
  return (data as AcpSessionRow | null) ?? null
}

export function isExpired(row: Pick<AcpSessionRow, 'expires_at'>): boolean {
  return new Date(row.expires_at).getTime() < Date.now()
}
