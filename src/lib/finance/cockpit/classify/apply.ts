import 'server-only'

/**
 * Classifying a transaction and writing the result down.
 *
 * The order is deliberate (plan §7):
 *   1. deterministic rules — free, instant, and a human decision when learned
 *   2. Claude — only for what is left
 *   3. thresholds decide whether it lands as fact or as a suggestion to review
 *
 * Then the allocation side-effects: first reverse whatever this transaction
 * previously did to the plan, then apply the new effects. That order is what
 * makes re-classification safe; without it a correction would draw the salary
 * buffer down twice. What is currently in force is stored on the row itself
 * (bank_transactions.allocation_applied), so nothing has to be reconstructed
 * from history.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'
import { logFinanceEvent } from '../events'
import { todayISO } from '../dates'
import { allocationEffects, type AllocationChange, type AllocationState } from './allocation-effect'
import { classifyWithAi, type AiCorrectionExample } from './ai'
import { classifyDeterministic, type ClassifiableTransaction, type Classification, type RuleContext } from './rules'
import { reverseChanges } from './reverse'

type Admin = SupabaseClient<Database>

/** Above this the AI answer is stored as fact; below it a human is asked. */
export const AI_AUTO_THRESHOLD = 0.9
/** Below this we store nothing at all and leave the row unclassified. */
export const AI_SUGGEST_THRESHOLD = 0.6

export interface ClassifyOutcome {
  transactionId: string
  classification: Classification | null
  needsReview: boolean
  changes: AllocationChange[]
  reversed: number
  skipped?: 'unchanged' | 'not_completed'
}

// ── Context loading ──────────────────────────────────────────────────────────

export async function loadRuleContext(supabase: Admin): Promise<RuleContext & { boats: Array<{ id: string; name: string }>; corrections: AiCorrectionExample[] }> {
  const [staffRes, paymentsRes, obligationsRes, rulesRes, boatsRes, connRes, correctionsRes] = await Promise.all([
    supabase.from('staff').select('id, name, role').eq('is_active', true),
    supabase.from('finance_loan_payments').select('id, loan_id, due_date, total_cents, is_paid, finance_loans!inner(name, lender_name, status)').eq('is_paid', false),
    supabase.from('finance_obligations').select('id, title, kind, amount_cents, due_date, status').eq('status', 'open'),
    supabase.from('finance_classification_rules').select('*').eq('is_active', true),
    supabase.from('boats').select('id, name').eq('is_active', true),
    supabase.from('revolut_connection').select('account_name').eq('id', 'default').maybeSingle(),
    supabase.from('bank_transactions')
      .select('description, merchant, counterparty, amount_cents, category, subcategory')
      .eq('classified_by', 'user')
      .order('reviewed_at', { ascending: false })
      .limit(20),
  ])

  const loanPayments = (paymentsRes.data ?? []).flatMap(r => {
    const loan = r.finance_loans as unknown as { name: string; lender_name: string; status: string } | null
    if (!loan || loan.status !== 'active') return []
    return [{
      id: r.id, loanId: r.loan_id, loanName: loan.name, lenderName: loan.lender_name,
      dueDate: r.due_date, totalCents: r.total_cents, isPaid: r.is_paid,
    }]
  })

  return {
    today: todayISO(),
    staff: (staffRes.data ?? []).map(s => ({ id: s.id, name: s.name, role: s.role })),
    loanPayments,
    obligations: (obligationsRes.data ?? []).map(o => ({
      id: o.id, title: o.title, kind: o.kind, amountCents: o.amount_cents, dueDate: o.due_date, status: o.status,
    })),
    learnedRules: (rulesRes.data ?? []).map(r => ({
      id: r.id,
      matchField: r.match_field as 'counterparty_name' | 'merchant_name' | 'description' | 'reference',
      pattern: r.pattern,
      direction: r.direction as 'in' | 'out' | 'any',
      category: r.category,
      subcategory: r.subcategory,
      boatId: r.boat_id,
      goalId: r.goal_id,
      priority: r.priority,
      isActive: r.is_active,
    })),
    ownAccountNames: connRes.data?.account_name ? [connRes.data.account_name] : [],
    boats: boatsRes.data ?? [],
    corrections: (correctionsRes.data ?? []).flatMap(c => {
      if (!c.category) return []
      const merchant = c.merchant as { name?: string } | null
      const counterparty = c.counterparty as { name?: string } | null
      const label = merchant?.name ?? counterparty?.name ?? c.description ?? ''
      if (!label) return []
      return [{ label, amountCents: c.amount_cents, category: c.category, subcategory: c.subcategory }]
    }),
  }
}

async function loadAllocationState(supabase: Admin): Promise<AllocationState> {
  const [settingsRes, goalsRes, obligationsRes, paymentsRes] = await Promise.all([
    supabase.from('finance_settings').select('owner_salary_coverage_cents').eq('id', 'default').maybeSingle(),
    supabase.from('finance_goals').select('id, name, target_cents, funded_cents, status'),
    supabase.from('finance_obligations').select('id, title, amount_cents, status'),
    supabase.from('finance_loan_payments').select('id, due_date, total_cents, is_paid, finance_loans!inner(name)'),
  ])
  return {
    ownerSalaryCoverageCents: settingsRes.data?.owner_salary_coverage_cents ?? 0,
    goals: (goalsRes.data ?? []).map(g => ({ id: g.id, name: g.name, targetCents: g.target_cents, fundedCents: g.funded_cents, status: g.status })),
    obligations: (obligationsRes.data ?? []).map(o => ({ id: o.id, title: o.title, amountCents: o.amount_cents, status: o.status })),
    loanPayments: (paymentsRes.data ?? []).map(p => ({
      id: p.id,
      loanName: (p.finance_loans as unknown as { name: string }).name,
      dueDate: p.due_date,
      totalCents: p.total_cents,
      isPaid: p.is_paid,
    })),
  }
}

export function toClassifiable(row: Database['public']['Tables']['bank_transactions']['Row']): ClassifiableTransaction {
  const merchant = row.merchant as { name?: string; category_code?: string } | null
  const counterparty = row.counterparty as { name?: string; account_type?: string } | null
  return {
    id: row.id,
    revolutId: row.revolut_id,
    type: row.type,
    state: row.state,
    amountCents: row.amount_cents,
    feeCents: row.fee_cents,
    createdAt: row.created_at,
    reference: row.reference,
    description: row.description,
    counterpartyName: counterparty?.name ?? null,
    counterpartyAccountType: counterparty?.account_type ?? null,
    merchantName: merchant?.name ?? null,
    merchantCategoryCode: merchant?.category_code ?? null,
  }
}

// ── Applying one classification ──────────────────────────────────────────────

export interface ApplyOptions {
  /** A human decision: stored as fact, never overridden by a later AI pass. */
  userClassification?: Classification
  actor?: 'user' | 'cron' | 'ai' | 'system'
  /** Skip the model (used by the cron's dry run and by tests). */
  skipAi?: boolean
  aiOverride?: typeof classifyWithAi
}

export async function classifyAndApply(
  supabase: Admin,
  row: Database['public']['Tables']['bank_transactions']['Row'],
  ctx: Awaited<ReturnType<typeof loadRuleContext>>,
  opts: ApplyOptions = {},
): Promise<ClassifyOutcome> {
  const tx = toClassifiable(row)
  const actor = opts.actor ?? (opts.userClassification ? 'user' : 'cron')

  let classification: Classification | null = opts.userClassification ?? classifyDeterministic(tx, ctx)
  let needsReview = false

  if (!classification && !opts.skipAi) {
    const ai = await (opts.aiOverride ?? classifyWithAi)(tx, { boats: ctx.boats, recentCorrections: ctx.corrections })
    if (ai && ai.confidence >= AI_SUGGEST_THRESHOLD) {
      classification = ai
      needsReview = ai.confidence < AI_AUTO_THRESHOLD
    }
  }

  if (!classification) {
    // Nothing confident enough. Leave the row untouched but mark it for a human.
    await supabase.from('bank_transactions').update({ needs_review: true }).eq('id', row.id)
    return { transactionId: row.id, classification: null, needsReview: true, changes: [], reversed: 0 }
  }

  // Reverse what this row previously did, then work out what it should do now.
  const previouslyApplied = (row.allocation_applied as AllocationChange[] | null) ?? []
  const allocation = await loadAllocationState(supabase)
  const reversals = reverseChanges(previouslyApplied)
  if (reversals.length > 0) {
    await applyReversals(supabase, reversals, allocation, row.id)
  }

  const freshAllocation = reversals.length > 0 ? await loadAllocationState(supabase) : allocation
  const changes = allocationEffects({
    amountCents: row.amount_cents,
    state: row.state,
    classification,
    allocation: freshAllocation,
  })
  await applyChanges(supabase, changes, freshAllocation, row.id)

  const { error } = await supabase
    .from('bank_transactions')
    .update({
      category: classification.category,
      subcategory: classification.subcategory,
      boat_id: classification.boatId ?? null,
      goal_id: classification.goalId ?? null,
      obligation_id: classification.obligationId ?? null,
      loan_payment_id: classification.loanPaymentId ?? null,
      classified_by: classification.source,
      confidence: classification.confidence,
      classification_reason: classification.reason,
      needs_review: needsReview,
      reviewed_at: actor === 'user' ? new Date().toISOString() : row.reviewed_at,
      allocation_applied: changes.length > 0 ? (changes as never) : null,
      allocation_applied_at: changes.length > 0 ? new Date().toISOString() : null,
    })
    .eq('id', row.id)
  if (error) throw new Error(error.message)

  if (classification.ruleId) {
    await supabase.rpc('increment_rule_hit' as never, { rule_id: classification.ruleId } as never).then(
      () => undefined,
      // No RPC yet; a plain update is fine and keeps this best-effort.
      async () => {
        const { data } = await supabase.from('finance_classification_rules').select('hit_count').eq('id', classification!.ruleId!).maybeSingle()
        await supabase.from('finance_classification_rules')
          .update({ hit_count: (data?.hit_count ?? 0) + 1, last_hit_at: new Date().toISOString() })
          .eq('id', classification!.ruleId!)
      },
    )
  }

  await logFinanceEvent(supabase, {
    event_type: actor === 'user' ? 'transaction_reclassified' : 'transaction_classified',
    actor,
    entity_type: 'transaction',
    entity_id: row.id,
    delta_cents: null,
    payload: {
      category: classification.category,
      subcategory: classification.subcategory,
      source: classification.source,
      confidence: classification.confidence,
      reason: classification.reason,
      needs_review: needsReview,
      reversed: reversals.length,
      changes: changes.map(c => c.kind),
    },
  })

  return { transactionId: row.id, classification, needsReview, changes, reversed: reversals.length }
}

// ── Writing the effects ──────────────────────────────────────────────────────

async function applyChanges(supabase: Admin, changes: AllocationChange[], state: AllocationState, transactionId: string): Promise<void> {
  for (const change of changes) {
    switch (change.kind) {
      case 'owner_salary_drawdown':
        await supabase.from('finance_settings').update({ owner_salary_coverage_cents: change.newCoverageCents, updated_at: new Date().toISOString() }).eq('id', 'default')
        await event(supabase, 'owner_salary_drawn', 'settings', null, -change.amountCents, change.reason, transactionId)
        break
      case 'goal_drawdown':
        await supabase.from('finance_goals').update({ funded_cents: change.newFundedCents, updated_at: new Date().toISOString() }).eq('id', change.goalId)
        await event(supabase, 'goal_funding_changed', 'goal', change.goalId, -change.amountCents, change.reason, transactionId)
        break
      case 'goal_completed':
        await supabase.from('finance_goals').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_transaction_id: transactionId,
          updated_at: new Date().toISOString(),
        }).eq('id', change.goalId)
        await event(supabase, 'goal_completed', 'goal', change.goalId, -change.releasedCents, change.reason, transactionId)
        break
      case 'obligation_paid':
        await supabase.from('finance_obligations').update({
          status: 'paid', paid_at: new Date().toISOString(), paid_transaction_id: transactionId, updated_at: new Date().toISOString(),
        }).eq('id', change.obligationId)
        await event(supabase, 'obligation_paid', 'obligation', change.obligationId, change.amountCents, change.reason, transactionId)
        break
      case 'loan_payment_paid':
        await supabase.from('finance_loan_payments').update({
          is_paid: true, paid_at: new Date().toISOString(), paid_transaction_id: transactionId,
        }).eq('id', change.loanPaymentId)
        await event(supabase, 'loan_payment_paid', 'loan_payment', change.loanPaymentId, change.amountCents, change.reason, transactionId)
        break
    }
  }
  void state
}

async function applyReversals(supabase: Admin, reversals: ReturnType<typeof reverseChanges>, state: AllocationState, transactionId: string): Promise<void> {
  for (const op of reversals) {
    switch (op.kind) {
      case 'owner_salary_restore':
        await supabase.from('finance_settings').update({
          owner_salary_coverage_cents: state.ownerSalaryCoverageCents + op.amountCents,
          updated_at: new Date().toISOString(),
        }).eq('id', 'default')
        await event(supabase, 'owner_salary_restored', 'settings', null, op.amountCents, 'Herclassificatie draait de eerdere afboeking terug', transactionId)
        break
      case 'goal_restore': {
        const goal = state.goals.find(g => g.id === op.goalId)
        await supabase.from('finance_goals').update({
          funded_cents: Math.min((goal?.fundedCents ?? 0) + op.amountCents, goal?.targetCents ?? Number.MAX_SAFE_INTEGER),
          updated_at: new Date().toISOString(),
        }).eq('id', op.goalId)
        await event(supabase, 'goal_funding_changed', 'goal', op.goalId, op.amountCents, 'Herclassificatie draait de eerdere afboeking terug', transactionId)
        break
      }
      case 'goal_reopen':
        await supabase.from('finance_goals').update({
          status: 'active', completed_at: null, completed_transaction_id: null,
          funded_cents: op.restoreFundedCents, updated_at: new Date().toISOString(),
        }).eq('id', op.goalId)
        await event(supabase, 'goal_reopened', 'goal', op.goalId, op.restoreFundedCents, 'Herclassificatie maakt het doel weer actief', transactionId)
        break
      case 'obligation_reopen':
        await supabase.from('finance_obligations').update({
          status: 'open', paid_at: null, paid_transaction_id: null, updated_at: new Date().toISOString(),
        }).eq('id', op.obligationId)
        await event(supabase, 'obligation_reopened', 'obligation', op.obligationId, null, 'Herclassificatie maakt de verplichting weer open', transactionId)
        break
      case 'loan_payment_reopen':
        await supabase.from('finance_loan_payments').update({ is_paid: false, paid_at: null, paid_transaction_id: null }).eq('id', op.loanPaymentId)
        await event(supabase, 'loan_payment_reopened', 'loan_payment', op.loanPaymentId, null, 'Herclassificatie maakt de termijn weer open', transactionId)
        break
    }
  }
}

async function event(
  supabase: Admin,
  eventType: string,
  entityType: 'settings' | 'goal' | 'obligation' | 'loan_payment',
  entityId: string | null,
  deltaCents: number | null,
  reason: string,
  transactionId: string,
): Promise<void> {
  await logFinanceEvent(supabase, {
    event_type: eventType,
    actor: 'system',
    entity_type: entityType,
    entity_id: entityId,
    delta_cents: deltaCents,
    payload: { reason, transaction_id: transactionId },
  })
}
