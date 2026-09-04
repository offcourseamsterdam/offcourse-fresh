/**
 * Deterministic classification. Pure: transaction plus context in, verdict out.
 *
 * Three layers run in order, and the first hit wins (plan §7):
 *   1. Structural rules — things we know for certain from our own records:
 *      a loan payment landing on a scheduled date, an internal transfer, a
 *      bank fee, a payment to someone on the staff list, a payout from a
 *      channel we already reconcile in the kasboek.
 *   2. Learned rules — patterns Beer created by correcting a transaction.
 *   3. Nothing. The caller then asks the AI (ai.ts).
 *
 * Only layer 1 may link a transaction to a specific loan payment, obligation
 * or goal, because only layer 1 has evidence for it. A learned rule can set a
 * goal, but never an obligation: obligations are dated one-offs, and matching
 * them by name would silently mark the wrong month paid.
 */

import { daysBetween, type ISODate } from '../dates'
import { directionAllows, isCategory, type Category } from './taxonomy'

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface ClassifiableTransaction {
  id: string
  revolutId: string
  type: string
  state: string
  amountCents: number
  feeCents: number
  createdAt: string
  reference: string | null
  description: string | null
  counterpartyName: string | null
  counterpartyAccountType: string | null
  merchantName: string | null
  merchantCategoryCode: string | null
}

export interface StaffMember {
  id: string
  name: string
  role: string | null
}

export interface LoanPaymentCandidate {
  id: string
  loanId: string
  loanName: string
  lenderName: string
  dueDate: ISODate
  totalCents: number
  isPaid: boolean
}

export interface ObligationCandidate {
  id: string
  title: string
  kind: string
  amountCents: number
  dueDate: ISODate
  status: string
}

export interface LearnedRule {
  id: string
  matchField: 'counterparty_name' | 'merchant_name' | 'description' | 'reference'
  pattern: string
  direction: 'in' | 'out' | 'any'
  category: string
  subcategory: string | null
  boatId: string | null
  goalId: string | null
  priority: number
  isActive: boolean
}

export interface RuleContext {
  today: ISODate
  staff: StaffMember[]
  loanPayments: LoanPaymentCandidate[]
  obligations: ObligationCandidate[]
  learnedRules: LearnedRule[]
  /** Names of Revolut accounts we own, so transfers between them are internal. */
  ownAccountNames?: string[]
}

export interface Classification {
  category: Category
  subcategory: string | null
  boatId?: string | null
  goalId?: string | null
  obligationId?: string | null
  loanPaymentId?: string | null
  confidence: number
  reason: string
  source: 'rule' | 'ai' | 'user'
  /** Which learned rule fired, so we can bump its hit count. */
  ruleId?: string | null
}

// ── Known counterparties ─────────────────────────────────────────────────────
// Drawn from the real feed. Each entry is a lowercase substring test against
// the counterparty or merchant name.

/** Money in from these is booking revenue: our own checkout and the resellers. */
const REVENUE_SOURCES: Array<{ match: string; label: string }> = [
  { match: 'stripe', label: 'Stripe (eigen checkout)' },
  { match: 'getyourguide', label: 'GetYourGuide' },
  { match: 'viator', label: 'Viator' },
  { match: 'boat local', label: 'Boat Local' },
  { match: 'boatlocal', label: 'Boat Local' },
  { match: 'withlocals', label: 'Withlocals' },
  { match: 'click&boat', label: 'Click & Boat' },
  { match: 'clickandboat', label: 'Click & Boat' },
  { match: 'getmyboat', label: 'GetMyBoat' },
  { match: 'barqo', label: 'Barqo' },
  { match: 'airbnb', label: 'Airbnb' },
]

/** Payment processors: money in is settled customer money, still booking revenue. */
const PROCESSORS: Array<{ match: string; label: string }> = [
  { match: 'paypal', label: 'PayPal' },
  { match: 'mollie', label: 'Mollie' },
  { match: 'worldline', label: 'Worldline' },
  { match: 'zettle', label: 'Zettle' },
  { match: 'adyen', label: 'Adyen' },
]

interface ExpensePattern {
  match: string
  category: Category
  subcategory: string
  label: string
}

const EXPENSE_PATTERN_LIST: ExpensePattern[] = [
  // Mooring
  { match: 'jachthaven', category: 'operating', subcategory: 'mooring', label: 'jachthaven' },
  { match: 'marina', category: 'operating', subcategory: 'mooring', label: 'marina' },
  { match: 'havenbedrijf', category: 'operating', subcategory: 'mooring', label: 'havenbedrijf' },
  { match: 'waternet', category: 'operating', subcategory: 'mooring', label: 'Waternet' },
  // Insurance
  { match: 'schepenverz', category: 'operating', subcategory: 'insurance', label: 'schepenverzekering' },
  { match: 'verzekering', category: 'operating', subcategory: 'insurance', label: 'verzekering' },
  { match: 'e.o.c.', category: 'operating', subcategory: 'insurance', label: 'E.O.C.' },
  // Catering and drinks
  { match: 'taste vin', category: 'operating', subcategory: 'catering', label: 'Taste Vin' },
  { match: 'drankengilde', category: 'operating', subcategory: 'catering', label: 'Drankengilde' },
  { match: 'marqt', category: 'operating', subcategory: 'catering', label: 'Marqt' },
  { match: 'albert heijn', category: 'operating', subcategory: 'catering', label: 'Albert Heijn' },
  { match: 'sligro', category: 'operating', subcategory: 'catering', label: 'Sligro' },
  { match: 'makro', category: 'operating', subcategory: 'catering', label: 'Makro' },
  // Software and tooling
  { match: 'fareharbor', category: 'operating', subcategory: 'software', label: 'FareHarbor' },
  { match: 'anthropic', category: 'operating', subcategory: 'software', label: 'Anthropic' },
  { match: 'supabase', category: 'operating', subcategory: 'software', label: 'Supabase' },
  { match: 'vercel', category: 'operating', subcategory: 'software', label: 'Vercel' },
  { match: 'snelstart', category: 'operating', subcategory: 'software', label: 'SnelStart' },
  { match: 'openai', category: 'operating', subcategory: 'software', label: 'OpenAI' },
  { match: 'google', category: 'operating', subcategory: 'software', label: 'Google' },
  { match: 'twilio', category: 'operating', subcategory: 'software', label: 'Twilio' },
  { match: 'resend', category: 'operating', subcategory: 'software', label: 'Resend' },
  { match: 'slack', category: 'operating', subcategory: 'software', label: 'Slack' },
  { match: 'figma', category: 'operating', subcategory: 'software', label: 'Figma' },
  { match: 'apple.com/bill', category: 'operating', subcategory: 'software', label: 'Apple' },
  // Marketing
  { match: 'google ads', category: 'operating', subcategory: 'marketing', label: 'Google Ads' },
  { match: 'meta platforms', category: 'operating', subcategory: 'marketing', label: 'Meta' },
  { match: 'facebook', category: 'operating', subcategory: 'marketing', label: 'Meta' },
  // Fuel and charging
  { match: 'shell', category: 'operating', subcategory: 'fuel', label: 'Shell' },
  { match: 'allego', category: 'operating', subcategory: 'fuel', label: 'Allego' },
  { match: 'vattenfall', category: 'operating', subcategory: 'fuel', label: 'Vattenfall' },
  { match: 'eneco', category: 'operating', subcategory: 'fuel', label: 'Eneco' },
  // Tax
  { match: 'belastingdienst', category: 'tax', subcategory: 'vat', label: 'Belastingdienst' },
]

// Longest pattern first, so "Google Ads" is marketing rather than matching the
// shorter "google" software rule that happens to be listed above it.
const EXPENSE_PATTERNS: ExpensePattern[] = [...EXPENSE_PATTERN_LIST].sort((a, b) => b.match.length - a.match.length)

// ── Helpers ──────────────────────────────────────────────────────────────────

function norm(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().trim()
}

/**
 * Substring match that refuses to fire in the middle of a longer word.
 * Without this, "marina" matches the supplier "Marinaio" and books a
 * restaurant as a berth fee — a real false positive from the live feed.
 * The boundary is checked on letters and digits only, so patterns that
 * already contain punctuation ("e.o.c.", "apple.com/bill") still work.
 */
export function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at === -1) return false
    const before = at === 0 ? '' : haystack[at - 1]
    const afterIndex = at + needle.length
    const after = afterIndex >= haystack.length ? '' : haystack[afterIndex]
    const isWordChar = (c: string) => c !== '' && /[a-z0-9]/.test(c)
    if (!isWordChar(before) && !isWordChar(after)) return true
    from = at + 1
  }
}

/** Revolut writes "To John Doe" / "Payment from Acme B.V." into the description. */
export function counterpartyText(tx: ClassifiableTransaction): string {
  return norm([tx.counterpartyName, tx.merchantName, tx.description, tx.reference].filter(Boolean).join(' | '))
}

function matchesAny(haystack: string, needles: Array<{ match: string; label: string }>): { label: string } | null {
  for (const n of needles) {
    if (containsWord(haystack, n.match)) return { label: n.label }
  }
  return null
}

/**
 * A staff name hit needs both parts of a two-word name, or a distinctive single
 * word. "Mare" alone would match "Marqt" and "Marinaio", so a single-word name
 * shorter than five characters only counts when it stands as its own word.
 */
export function matchesStaffName(haystack: string, name: string): boolean {
  const parts = norm(name).split(/\s+/).filter(p => p.length > 1)
  if (parts.length === 0) return false
  if (parts.length === 1) {
    const p = parts[0]
    if (p.length >= 5) return haystack.includes(p)
    return new RegExp(`(^|[^a-z0-9])${p}([^a-z0-9]|$)`, 'i').test(haystack)
  }
  return parts.every(p => haystack.includes(p))
}

// ── Layer 1: structural ──────────────────────────────────────────────────────

const LOAN_DATE_TOLERANCE_DAYS = 5
/** A loan payment is recognised when the amount is within this of the schedule. */
const LOAN_AMOUNT_TOLERANCE_CENTS = 100

export function classifyStructural(tx: ClassifiableTransaction, ctx: RuleContext): Classification | null {
  const text = counterpartyText(tx)
  const outgoing = tx.amountCents < 0
  const abs = Math.abs(tx.amountCents)

  // Bank and transaction fees. Revolut types these explicitly.
  if (tx.type === 'fee') {
    return rule('operating', 'fees', 1, 'Revolut boekt dit als kosten', {})
  }

  // Internal movement between our own Revolut accounts or pockets.
  const ownNames = (ctx.ownAccountNames ?? []).map(norm).filter(n => n.length > 1)
  const isOwnCounterparty = ownNames.some(n => containsWord(text, n))
  if (tx.counterpartyAccountType === 'self' || isOwnCounterparty) {
    return rule('transfer', 'internal', 1, 'Overboeking tussen eigen rekeningen', {})
  }

  // A scheduled loan payment: right lender, right window, right amount.
  if (outgoing) {
    for (const p of ctx.loanPayments) {
      if (p.isPaid) continue
      if (!matchesStaffName(text, p.lenderName) && !containsWord(text, norm(p.lenderName))) continue
      const dayGap = Math.abs(daysBetween(p.dueDate, tx.createdAt.slice(0, 10)))
      if (dayGap > LOAN_DATE_TOLERANCE_DAYS) continue
      if (Math.abs(abs - p.totalCents) > LOAN_AMOUNT_TOLERANCE_CENTS) continue
      // Interest-only periods repay nothing, so the split decides the subcategory.
      return rule('financing', 'loan_repayment', 1, `Geplande betaling voor ${p.loanName} op ${p.dueDate}`, {
        loanPaymentId: p.id,
      })
    }
  }

  // Someone on the staff list. Beer himself is owner salary, everyone else crew.
  if (outgoing) {
    for (const s of ctx.staff) {
      if (!matchesStaffName(text, s.name)) continue
      const isOwner = norm(s.role) === 'owner'
      return isOwner
        ? rule('owner', 'salary', 0.9, `Betaling aan ${s.name} (eigenaar)`, {})
        : rule('operating', 'crew', 0.9, `Betaling aan ${s.name} (${s.role ?? 'bemanning'})`, {})
    }
  }

  // Money in from a channel we already reconcile in the kasboek.
  if (!outgoing) {
    const channel = matchesAny(text, REVENUE_SOURCES)
    if (channel) return rule('income', 'booking', 1, `Uitbetaling van ${channel.label}`, {})
    const processor = matchesAny(text, PROCESSORS)
    if (processor) return rule('income', 'booking', 0.85, `Afgerekend via ${processor.label}`, {})
  }

  // A named supplier we recognise, on the way out only: several of these names
  // are customers on the way in.
  if (outgoing) {
    for (const p of EXPENSE_PATTERNS) {
      if (!containsWord(text, p.match)) continue
      return rule(p.category, p.subcategory, 0.95, `Herkend als ${p.label}`, {})
    }
  }

  // A dated obligation that matches on amount and window: taxes, insurance,
  // berth fees Beer entered by hand.
  if (outgoing) {
    for (const o of ctx.obligations) {
      if (o.status !== 'open') continue
      if (Math.abs(abs - o.amountCents) > LOAN_AMOUNT_TOLERANCE_CENTS) continue
      const dayGap = Math.abs(daysBetween(o.dueDate, tx.createdAt.slice(0, 10)))
      if (dayGap > LOAN_DATE_TOLERANCE_DAYS) continue
      const mapped = obligationCategory(o.kind)
      return rule(mapped.category, mapped.subcategory, 0.85, `Komt overeen met verplichting "${o.title}" (${o.dueDate})`, {
        obligationId: o.id,
      })
    }
  }

  return null

  function rule(
    category: Category,
    subcategory: string | null,
    confidence: number,
    reason: string,
    extra: Partial<Classification>,
  ): Classification {
    return { category, subcategory, confidence, reason, source: 'rule', ...extra }
  }
}

function obligationCategory(kind: string): { category: Category; subcategory: string } {
  switch (kind) {
    case 'tax': return { category: 'tax', subcategory: 'vat' }
    case 'insurance': return { category: 'operating', subcategory: 'insurance' }
    case 'berth': return { category: 'operating', subcategory: 'mooring' }
    case 'salary': return { category: 'owner', subcategory: 'salary' }
    case 'loan': return { category: 'financing', subcategory: 'loan_repayment' }
    default: return { category: 'operating', subcategory: 'other' }
  }
}

// ── Layer 2: learned rules ───────────────────────────────────────────────────

export function fieldValue(tx: ClassifiableTransaction, field: LearnedRule['matchField']): string {
  switch (field) {
    case 'counterparty_name': return norm(tx.counterpartyName)
    case 'merchant_name': return norm(tx.merchantName)
    case 'description': return norm(tx.description)
    case 'reference': return norm(tx.reference)
  }
}

export function classifyByLearnedRules(tx: ClassifiableTransaction, rules: LearnedRule[]): Classification | null {
  const incoming = tx.amountCents > 0
  const candidates = rules
    .filter(r => r.isActive)
    .filter(r => r.direction === 'any' || (r.direction === 'in') === incoming)
    .filter(r => isCategory(r.category) && directionAllows(r.category as Category, tx.amountCents))
    .filter(r => {
      const value = fieldValue(tx, r.matchField)
      return value.length > 0 && value.includes(norm(r.pattern))
    })
    // Highest priority wins; ties go to the most specific (longest) pattern.
    .sort((a, b) => b.priority - a.priority || b.pattern.length - a.pattern.length)

  const hit = candidates[0]
  if (!hit) return null
  return {
    category: hit.category as Category,
    subcategory: hit.subcategory,
    boatId: hit.boatId,
    goalId: hit.goalId,
    confidence: 1,
    reason: `Eigen regel: "${hit.pattern}"`,
    source: 'rule',
    ruleId: hit.id,
  }
}

// ── Entry point for the deterministic layers ─────────────────────────────────

export function classifyDeterministic(tx: ClassifiableTransaction, ctx: RuleContext): Classification | null {
  // A learned rule is a human decision, so it outranks our built-in guesses —
  // except for the links only we can prove (loan payment, obligation, internal
  // transfer), which stay authoritative.
  const structural = classifyStructural(tx, ctx)
  if (structural && (structural.loanPaymentId || structural.obligationId || structural.category === 'transfer')) {
    return structural
  }
  const learned = classifyByLearnedRules(tx, ctx.learnedRules)
  if (learned) return learned
  return structural
}
