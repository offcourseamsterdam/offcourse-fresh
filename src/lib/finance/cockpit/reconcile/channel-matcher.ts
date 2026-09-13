import 'server-only'

/**
 * channel-matcher.ts — Reconciles incoming bank_transactions (Revolut deposits)
 * with the revenue channels / Kasboek payout batches.
 *
 * Supported channels:
 * - Viator (viator_payment_batches)
 * - GetYourGuide (getyourguide_payments)
 * - BoatLocal (boatlocal_payout_batches)
 * - FareHarbor (fareharbor_payouts)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

type Admin = SupabaseClient<Database>

export type PayoutChannel =
  | 'viator'
  | 'getyourguide'
  | 'boatlocal'
  | 'fareharbor'
  | 'clickandboat'
  | 'barqo'

export interface PayoutMatchResult {
  channel: PayoutChannel
  recordId: string
  reference: string
  channelLabel: string
  exactAmountMatch: boolean
  totalAmountCents: number
  subtotalExCents: number
  vat9Cents: number
  vat21Cents: number
  confidence: number
  reason: string
}

export interface CandidatePool {
  viator: Array<{
    id: string
    document_number: string | null
    advice_date: string | null
    total_amount_cents: number | null
    raw_filename: string | null
  }>
  gyg: Array<{
    id: string
    payment_number: string | null
    payment_run_date: string | null
    amount_cents: number | null
  }>
  boatlocal: Array<{
    id: string
    invoice_number: string | null
    issue_date: string | null
    operator_payout_cents: number | null
    vat_9_in_payout_cents: number | null
  }>
  fareharbor: Array<{
    id: string
    payout_id: string
    payout_date: string | null
    bank_payout_date: string | null
    net_cents: number
    vat9_cents: number
    vat21_cents: number
    subtotal_paid_cents: number
  }>
}

export async function loadPayoutCandidatePool(supabase: Admin): Promise<CandidatePool> {
  const [viatorRes, gygRes, blRes, fhRes] = await Promise.all([
    supabase.from('viator_payment_batches').select('id, document_number, advice_date, total_amount_cents, raw_filename'),
    supabase.from('getyourguide_payments').select('id, payment_number, payment_run_date, amount_cents'),
    supabase.from('boatlocal_payout_batches').select('id, invoice_number, issue_date, operator_payout_cents, vat_9_in_payout_cents'),
    supabase.from('fareharbor_payouts').select('id, payout_id, payout_date, bank_payout_date, net_cents, vat9_cents, vat21_cents, subtotal_paid_cents'),
  ])

  return {
    viator: (viatorRes.data ?? []) as CandidatePool['viator'],
    gyg: (gygRes.data ?? []) as CandidatePool['gyg'],
    boatlocal: (blRes.data ?? []) as CandidatePool['boatlocal'],
    fareharbor: (fhRes.data ?? []) as CandidatePool['fareharbor'],
  }
}

/**
 * Matches an incoming bank transaction (amount > 0) against the payout pool.
 */
export function matchTransactionToPayout(
  tx: {
    amountCents: number
    description: string | null
    reference: string | null
    createdAt: string
  },
  pool: CandidatePool
): PayoutMatchResult | null {
  if (tx.amountCents <= 0) return null

  const desc = (tx.description || '').toLowerCase()
  const ref = (tx.reference || '').toLowerCase()
  const text = `${desc} ${ref}`

  // 1. Viator
  if (text.includes('viator')) {
    // Try exact amount first
    const exactMatch = pool.viator.find(v => v.total_amount_cents === tx.amountCents)
    if (exactMatch) {
      const vat9 = Math.round((tx.amountCents * 9) / 109)
      const refCode = exactMatch.document_number || tx.reference || 'Viator payout'
      return {
        channel: 'viator',
        recordId: exactMatch.id,
        reference: refCode,
        channelLabel: 'Viator',
        exactAmountMatch: true,
        totalAmountCents: tx.amountCents,
        subtotalExCents: tx.amountCents - vat9,
        vat9Cents: vat9,
        vat21Cents: 0,
        confidence: 1.0,
        reason: `Exacte match met Viator payout ${refCode} (€${(tx.amountCents / 100).toFixed(2)})`,
      }
    }
  }

  // 2. GetYourGuide
  if (text.includes('getyourguide') || text.includes('get your guide')) {
    const exactMatch = pool.gyg.find(g => g.amount_cents === tx.amountCents)
    if (exactMatch) {
      const vat9 = Math.round((tx.amountCents * 9) / 109)
      const refCode = exactMatch.payment_number || tx.reference || 'GYG payout'
      return {
        channel: 'getyourguide',
        recordId: exactMatch.id,
        reference: refCode,
        channelLabel: 'GetYourGuide',
        exactAmountMatch: true,
        totalAmountCents: tx.amountCents,
        subtotalExCents: tx.amountCents - vat9,
        vat9Cents: vat9,
        vat21Cents: 0,
        confidence: 1.0,
        reason: `Exacte match met GetYourGuide payout ${refCode} (€${(tx.amountCents / 100).toFixed(2)})`,
      }
    }
  }

  // 3. BoatLocal
  if (text.includes('boat local') || text.includes('boatlocal')) {
    const byRef = pool.boatlocal.find(b => b.invoice_number && ref.includes(b.invoice_number.toLowerCase()))
    const exactMatch = byRef ?? pool.boatlocal.find(b => b.operator_payout_cents === tx.amountCents)
    if (exactMatch && exactMatch.operator_payout_cents) {
      const vat9 = exactMatch.vat_9_in_payout_cents ?? Math.round((tx.amountCents * 9) / 109)
      const refCode = exactMatch.invoice_number || 'Boat Local payout'
      return {
        channel: 'boatlocal',
        recordId: exactMatch.id,
        reference: refCode,
        channelLabel: 'BoatLocal',
        exactAmountMatch: exactMatch.operator_payout_cents === tx.amountCents,
        totalAmountCents: tx.amountCents,
        subtotalExCents: tx.amountCents - vat9,
        vat9Cents: vat9,
        vat21Cents: 0,
        confidence: exactMatch.operator_payout_cents === tx.amountCents ? 1.0 : 0.85,
        reason: `Match met BoatLocal factuur ${refCode}`,
      }
    }
  }

  // 4. FareHarbor
  if (text.includes('fhoffcourse') || text.includes('fareharbor')) {
    const exactMatch = pool.fareharbor.find(f => f.net_cents === tx.amountCents)
    if (exactMatch) {
      const refCode = exactMatch.payout_id || 'FareHarbor'
      return {
        channel: 'fareharbor',
        recordId: exactMatch.id,
        reference: refCode,
        channelLabel: 'FareHarbor',
        exactAmountMatch: true,
        totalAmountCents: tx.amountCents,
        subtotalExCents: exactMatch.subtotal_paid_cents || tx.amountCents - exactMatch.vat9_cents - exactMatch.vat21_cents,
        vat9Cents: exactMatch.vat9_cents,
        vat21Cents: exactMatch.vat21_cents,
        confidence: 1.0,
        reason: `Exacte match met FareHarbor payout #${refCode} (€${(tx.amountCents / 100).toFixed(2)})`,
      }
    }
  }

  return null
}
