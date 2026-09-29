/**
 * Drafts the semi-annual INTEREST payment of every active loan in Revolut, on its due date
 * (1 April / 1 October — the calendar lives in schedule.ts, the amounts in finance_loan_payments).
 *
 * A DRAFT, never an executed payment: Revolut makes Beer open the app and confirm each one.
 * Only `interest_cents` is drafted. Principal repayments (none exist yet — every loan is still in
 * its interest-only years) are deliberately left alone and flagged in the outcome so Beer sees them.
 *
 * Idempotent: a period with a `revolut_draft_id` is never drafted again, so a retried cron or a
 * manual re-run can't produce a second draft for the same payment.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import type { RevolutClient } from '@/lib/revolut/client'
import { type DraftPaymentRefusal, createSinglePaymentDraft, ensureRevolutCounterparty, validateSupplierForDraft } from '@/lib/revolut/draft-payment'
import { addDays, type ISODate } from '../dates'
import { logFinanceEvent } from '../events'

type Admin = SupabaseClient<Database>

/** A period whose due date passed longer ago than this is left to Beer — the cron only chases fresh payments, not old history. */
export const DRAFT_LOOKBACK_DAYS = 14

export type InterestDraftStatus = 'drafted' | 'would_draft' | 'skipped' | 'failed'

export interface InterestDraftOutcome {
  paymentId: string
  loanId: string
  lender: string
  dueDate: ISODate
  interestCents: number
  status: InterestDraftStatus
  /** Human-readable Dutch reason for `skipped` / `failed`. */
  reason?: string
  draftId?: string
  /** Principal is due in the same period but is NOT part of the draft. */
  principalCents: number
}

const LENDER_REFUSAL_TEXT: Record<DraftPaymentRefusal, string> = {
  no_supplier: 'deze lening is nog niet gekoppeld aan een lener met IBAN — koppel die eerst',
  no_iban: 'deze lener heeft nog geen IBAN — vul die eerst aan',
  invalid_iban: 'het IBAN van deze lener klopt niet (controlegetal faalt) — corrigeer het eerst',
}

const MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

/** "1 oktober 2026" */
export function formatDueDateNl(date: ISODate): string {
  const [y, m, d] = date.split('-').map(Number)
  return `${d} ${MONTHS_NL[m - 1]} ${y}`
}

/** Shown to the lender on their bank statement. Short and plain, like the ones Beer typed by hand before. */
export function interestReference(dueDate: ISODate): string {
  return `Rente lening per ${formatDueDateNl(dueDate)}`
}

/** Slack text for one run. Returns null when there is nothing worth a message. */
export function formatInterestDraftSlack(outcomes: InterestDraftOutcome[]): string | null {
  const drafted = outcomes.filter(o => o.status === 'drafted' || o.status === 'would_draft')
  const problems = outcomes.filter(o => o.status === 'skipped' || o.status === 'failed')
  if (drafted.length === 0 && problems.length === 0) return null

  const eur = (cents: number) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100)
  const lines: string[] = []

  if (drafted.length > 0) {
    const due = formatDueDateNl(drafted[0].dueDate)
    lines.push(`💸 *Rente ${due} — ${drafted.length} ${drafted.length === 1 ? 'concept staat' : 'concepten staan'} klaar in Revolut*`)
    lines.push('Open de Revolut-app en keur ze goed:')
    for (const o of drafted) lines.push(`• ${o.lender} — ${eur(o.interestCents)}`)
    lines.push(`Totaal: ${eur(drafted.reduce((s, o) => s + o.interestCents, 0))}`)
    const withPrincipal = drafted.filter(o => o.principalCents > 0)
    if (withPrincipal.length > 0) {
      lines.push(`ℹ️ Let op: aflossing valt ook in deze periode en zit *niet* in het concept: ${withPrincipal.map(o => `${o.lender} ${eur(o.principalCents)}`).join(', ')}.`)
    }
  }

  if (problems.length > 0) {
    lines.push(`${drafted.length > 0 ? '\n' : ''}⚠️ *Niet klaargezet — handmatig regelen:*`)
    for (const o of problems) lines.push(`• ${o.lender} (${eur(o.interestCents)}, ${formatDueDateNl(o.dueDate)}): ${o.reason}`)
  }
  return lines.join('\n')
}

/** Reuses a counterparty Beer already created in Revolut (matched on IBAN) before creating a new one. */
async function resolveCounterpartyId(
  supabase: Admin,
  client: Pick<RevolutClient, 'createCounterparty' | 'getCounterparties'>,
  supplier: { id: string; name: string; iban: string | null; revolut_counterparty_id: string | null },
  iban: string,
): Promise<string> {
  if (supplier.revolut_counterparty_id) return supplier.revolut_counterparty_id

  const existing = (await client.getCounterparties()).find(c => c.accounts?.some(a => a.iban?.replace(/\s+/g, '').toUpperCase() === iban))
  if (existing) {
    const { error } = await supabase.from('finance_suppliers').update({ revolut_counterparty_id: existing.id }).eq('id', supplier.id)
    if (error) throw new Error(`Counterparty ${existing.id} found but could not be recorded: ${error.message}`)
    return existing.id
  }
  return ensureRevolutCounterparty(supabase, client, supplier, iban)
}

export interface DraftInterestOptions {
  today: ISODate
  /** Revolut account to pay from. Required unless `dryRun`. */
  accountId?: string
  /** Compute and report what WOULD be drafted; touch neither Revolut nor the database. */
  dryRun?: boolean
}

export async function draftDueLoanInterest(
  supabase: Admin,
  client: Pick<RevolutClient, 'createCounterparty' | 'getCounterparties' | 'createPaymentDraft'> | null,
  opts: DraftInterestOptions,
): Promise<InterestDraftOutcome[]> {
  const { today, accountId, dryRun = false } = opts
  if (!dryRun && (!client || !accountId)) throw new Error('A Revolut client and account are required for a live run')

  const { data, error } = await supabase
    .from('finance_loan_payments')
    .select('id, loan_id, due_date, interest_cents, principal_cents, finance_loans!inner(lender_name, status, supplier:finance_suppliers(id, name, iban, revolut_counterparty_id))')
    .eq('is_paid', false)
    .is('revolut_draft_id', null)
    .gt('interest_cents', 0)
    .lte('due_date', today)
    .gte('due_date', addDays(today, -DRAFT_LOOKBACK_DAYS))
    .order('due_date')
  if (error) throw new Error(error.message)

  const outcomes: InterestDraftOutcome[] = []
  for (const row of data ?? []) {
    const loan = row.finance_loans as unknown as { lender_name: string; status: string; supplier: { id: string; name: string; iban: string | null; revolut_counterparty_id: string | null } | null }
    if (loan.status !== 'active') continue

    const base = {
      paymentId: row.id, loanId: row.loan_id, lender: loan.lender_name, dueDate: row.due_date,
      interestCents: row.interest_cents, principalCents: row.principal_cents,
    }

    const validated = validateSupplierForDraft(loan.supplier)
    if (!validated.ok) {
      outcomes.push({ ...base, status: 'skipped', reason: LENDER_REFUSAL_TEXT[validated.reason] })
      continue
    }
    if (dryRun) { outcomes.push({ ...base, status: 'would_draft' }); continue }

    try {
      const counterpartyId = await resolveCounterpartyId(supabase, client!, loan.supplier!, validated.iban)
      const reference = interestReference(row.due_date)
      const draftId = await createSinglePaymentDraft(client!, {
        accountId: accountId!,
        counterpartyId,
        amountCents: row.interest_cents,
        title: `${reference} — ${loan.lender_name}`,
        reference,
      })
      // If pinning fails the draft exists but a retry would create a second one — surface it loudly.
      const { error: pinErr } = await supabase
        .from('finance_loan_payments')
        .update({ revolut_draft_id: draftId, drafted_at: new Date().toISOString() })
        .eq('id', row.id)
      if (pinErr) throw new Error(`Revolut-concept ${draftId} is aangemaakt maar kon niet worden vastgelegd (${pinErr.message}) — verwijder het concept in Revolut of markeer handmatig`)

      await logFinanceEvent(supabase, {
        event_type: 'loan_interest_drafted',
        actor: 'cron',
        entity_type: 'loan_payment',
        entity_id: row.id,
        delta_cents: row.interest_cents,
        payload: { loan_id: row.loan_id, lender: loan.lender_name, due_date: row.due_date, revolut_draft_id: draftId },
      })
      outcomes.push({ ...base, status: 'drafted', draftId })
    } catch (err) {
      outcomes.push({ ...base, status: 'failed', reason: err instanceof Error ? err.message : String(err) })
    }
  }
  return outcomes
}
