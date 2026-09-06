/**
 * Shared payment-drafting logic (docs/plans/2026-09-05-payment-drafting.md), lifted out of the
 * proven `invoices/[id]/pay/route.ts` pattern rather than duplicated: validate the payee's IBAN,
 * reuse-or-create a Revolut counterparty, reuse-or-create a payment draft. `invoices/[id]/pay`
 * itself is left untouched.
 *
 * A DRAFT, never an executed payment — Revolut requires a human to open the app and confirm it.
 * Nothing here can move money on its own.
 */
import { isValidIban, normalizeIban } from '@/lib/finance/iban'
import type { RevolutClient } from './client'
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export interface DraftPayableSupplier {
  id: string
  name: string
  iban: string | null
  revolut_counterparty_id: string | null
}

export type DraftPaymentRefusal = 'no_supplier' | 'no_iban' | 'invalid_iban'

export const DRAFT_REFUSAL_TEXT: Record<DraftPaymentRefusal, string> = {
  no_supplier: 'Koppel eerst een leverancier.',
  no_iban: 'Deze leverancier heeft nog geen IBAN — vul die eerst aan.',
  invalid_iban: 'Het IBAN van deze leverancier klopt niet (controlegetal faalt) — corrigeer het eerst.',
}

export type ValidatedSupplier = { ok: true; iban: string } | { ok: false; reason: DraftPaymentRefusal }

/** The one gate every draft-payment path shares: no supplier, no IBAN, or a checksum failure all refuse before Revolut is ever called. */
export function validateSupplierForDraft(supplier: DraftPayableSupplier | null | undefined): ValidatedSupplier {
  if (!supplier) return { ok: false, reason: 'no_supplier' }
  if (!supplier.iban) return { ok: false, reason: 'no_iban' }
  const iban = normalizeIban(supplier.iban)
  if (!isValidIban(iban)) return { ok: false, reason: 'invalid_iban' }
  return { ok: true, iban }
}

/** Reuses `finance_suppliers.revolut_counterparty_id`; creates and persists it the first time only. */
export async function ensureRevolutCounterparty(
  supabase: Admin,
  client: Pick<RevolutClient, 'createCounterparty'>,
  supplier: DraftPayableSupplier,
  iban: string,
): Promise<string> {
  if (supplier.revolut_counterparty_id) return supplier.revolut_counterparty_id
  const counterparty = await client.createCounterparty({ company_name: supplier.name, bank_country: iban.slice(0, 2), currency: 'EUR', iban })
  const { error } = await supabase.from('finance_suppliers').update({ revolut_counterparty_id: counterparty.id }).eq('id', supplier.id)
  if (error) throw new Error(`Counterparty ${counterparty.id} created but could not be recorded: ${error.message}`)
  return counterparty.id
}

export interface SinglePaymentDraftOptions {
  accountId: string
  counterpartyId: string
  amountCents: number
  title: string
  /** Revolut caps this at 140 characters; longer input is truncated, never rejected. */
  reference: string
}

/** One draft, one payment line — every current caller (invoice/obligation/expense) pays exactly one payee at a time. */
export async function createSinglePaymentDraft(client: Pick<RevolutClient, 'createPaymentDraft'>, opts: SinglePaymentDraftOptions): Promise<string> {
  const draft = await client.createPaymentDraft({
    title: opts.title,
    payments: [{ account_id: opts.accountId, receiver: { counterparty_id: opts.counterpartyId }, amount: opts.amountCents / 100, currency: 'EUR', reference: opts.reference.slice(0, 140) }],
  })
  return draft.id
}
