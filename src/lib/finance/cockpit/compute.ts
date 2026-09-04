/**
 * THE formula. Every number the finance module shows comes from here:
 *
 *   cleared cash
 *   − obligations within the horizon
 *   − operational coverage
 *   − owner salary coverage (stored buffer)
 *   − goal funding (stored reserves)
 *   = financiële ruimte vóór veiligheidsmarge          (may be negative)
 *
 *   financiële ruimte − gewenste veiligheidsmarge = beschikbaar voor groei (floored at 0)
 *
 * The allocation bar is the same formula visualised as a waterfall: cash fills
 * the buckets in priority order, so the segments always sum to cleared cash.
 * The safety margin is a threshold on the free segment, never a bucket.
 *
 * Pure. No dates are computed here (obligations arrive already expanded), no
 * database, no rounding surprises: all inputs are integer cents.
 */

import { horizonEnd } from './obligations'
import type { Bucket, BucketKey, CockpitInputs, CockpitResult, StatusLevel, WhyLine } from './types'
import { BUCKET_LABELS, DEFAULT_PRIORITY, HORIZON_LABELS, STATUS_LABELS } from './types'

const ATTENTION_DAYS = 14

export function computeCockpit(input: CockpitInputs): CockpitResult {
  const cash = Math.max(0, Math.round(input.cash.clearedCents))
  const priority = normalizePriority(input.priority)

  const obligationsCents = sum(input.obligations.map(o => o.amountCents))
  const operationalCents = Math.max(0, input.operationalCoverageCents)
  const salaryCoverageCents = Math.max(0, input.ownerSalary.coverageCents)
  const goalsCents = sum(input.goals.map(g => g.fundedCents))

  const required: Record<BucketKey, number> = {
    obligations: obligationsCents,
    operational: operationalCents,
    owner_salary: salaryCoverageCents,
    goals: goalsCents,
  }

  // Waterfall: fill buckets in priority order from cleared cash.
  let remaining = cash
  const buckets: Bucket[] = priority.map(key => {
    const req = required[key]
    const funded = Math.min(req, remaining)
    remaining -= funded
    return { key, label: BUCKET_LABELS[key], requiredCents: req, fundedCents: funded, shortfallCents: req - funded }
  })
  const freeCents = remaining

  const requiredCents = sum(Object.values(required))
  const financialSpaceCents = cash - requiredCents
  const safetyMarginCents = Math.max(0, input.safetyMarginCents)
  const availableForGrowthCents = Math.max(0, financialSpaceCents - safetyMarginCents)
  const marginShortfallCents = Math.max(0, safetyMarginCents - financialSpaceCents)
  const reserveOverrunCents = Math.max(0, -financialSpaceCents)

  const salaryTargetCents = Math.max(0, input.ownerSalary.monthlyCents) * Math.max(0, input.ownerSalary.months)
  const monthsCovered = input.ownerSalary.monthlyCents > 0
    ? Math.floor((salaryCoverageCents / input.ownerSalary.monthlyCents) * 10) / 10
    : 0

  const status = deriveStatus({
    financialSpaceCents,
    safetyMarginCents,
    buckets,
    input,
    monthsCovered,
  })

  const why = buildWhy({
    input,
    cash,
    obligationsCents,
    operationalCents,
    salaryCoverageCents,
    goalsCents,
    financialSpaceCents,
    safetyMarginCents,
    availableForGrowthCents,
    marginShortfallCents,
  })

  return {
    today: input.today,
    horizon: input.horizon,
    horizonEnd: horizonEnd(input.today, input.horizon),
    cash: input.cash,
    buckets,
    requiredCents,
    freeCents,
    financialSpaceCents,
    safetyMarginCents,
    availableForGrowthCents,
    marginShortfallCents,
    reserveOverrunCents,
    ownerSalary: {
      monthlyCents: input.ownerSalary.monthlyCents,
      targetMonths: input.ownerSalary.months,
      targetCents: salaryTargetCents,
      coverageCents: salaryCoverageCents,
      monthsCovered,
    },
    obligations: input.obligations,
    goals: input.goals,
    status,
    why,
  }
}

// ── Status ───────────────────────────────────────────────────────────────────

function deriveStatus(args: {
  financialSpaceCents: number
  safetyMarginCents: number
  buckets: Bucket[]
  input: CockpitInputs
  monthsCovered: number
}): { level: StatusLevel; label: string; reasons: string[] } {
  const { financialSpaceCents, safetyMarginCents, buckets, input } = args
  const tight: string[] = []
  const attention: string[] = []

  if (financialSpaceCents < 0) {
    tight.push(`Je verplichtingen en reserveringen zijn €${eur(-financialSpaceCents)} groter dan je cash.`)
  }
  const obligationsBucket = buckets.find(b => b.key === 'obligations')
  if (obligationsBucket && obligationsBucket.shortfallCents > 0) {
    tight.push(`Verplichtingen zijn €${eur(obligationsBucket.shortfallCents)} onderdekt.`)
  }
  const overdue = input.obligations.filter(o => o.overdue)
  if (overdue.length > 0) {
    tight.push(`${overdue.length} verplichting${overdue.length === 1 ? '' : 'en'} over tijd.`)
  }
  if (input.cash.source === 'none') {
    tight.push('Geen saldo bekend: koppel Revolut of vul een saldo in.')
  }

  if (tight.length === 0 && financialSpaceCents < safetyMarginCents) {
    attention.push(`Financiële ruimte ligt €${eur(safetyMarginCents - financialSpaceCents)} onder de gewenste veiligheidsmarge.`)
  }
  for (const b of buckets) {
    if (b.key !== 'obligations' && b.shortfallCents > 0) {
      attention.push(`${b.label} is €${eur(b.shortfallCents)} onderdekt.`)
    }
  }
  const behind = input.goals.filter(g => g.behindCents > 0)
  if (behind.length > 0) {
    attention.push(behind.length === 1
      ? `${behind[0].name} loopt €${eur(behind[0].behindCents)} achter op schema.`
      : `${behind.length} doelen lopen achter op schema.`)
  }
  const soonEnd = addDaysISO(input.today, ATTENTION_DAYS)
  const soon = input.obligations.filter(o => !o.overdue && o.dueDate <= soonEnd)
  if (soon.length > 0 && obligationsBucket && obligationsBucket.shortfallCents > 0) {
    attention.push(`${soon.length} verplichting${soon.length === 1 ? '' : 'en'} binnen ${ATTENTION_DAYS} dagen zonder volledige dekking.`)
  }
  if (input.ownerSalary.monthlyCents > 0 && args.monthsCovered < 1) {
    attention.push('Eigenaarssalaris is minder dan 1 maand gedekt.')
  }

  if (tight.length > 0) return { level: 'tight', label: STATUS_LABELS.tight, reasons: tight.concat(attention) }
  if (attention.length > 0) return { level: 'attention', label: STATUS_LABELS.attention, reasons: attention }
  return { level: 'healthy', label: STATUS_LABELS.healthy, reasons: ['Verplichtingen, reserveringen en veiligheidsmarge zijn volledig gedekt.'] }
}

// ── "Waarom?" ────────────────────────────────────────────────────────────────

function buildWhy(a: {
  input: CockpitInputs
  cash: number
  obligationsCents: number
  operationalCents: number
  salaryCoverageCents: number
  goalsCents: number
  financialSpaceCents: number
  safetyMarginCents: number
  availableForGrowthCents: number
  marginShortfallCents: number
}): WhyLine[] {
  const { input } = a
  const lines: WhyLine[] = []
  lines.push({
    label: input.cash.source === 'revolut' ? 'Cash bij Revolut (vrijgegeven saldo)' : input.cash.source === 'manual' ? 'Saldo (handmatig ingevoerd)' : 'Saldo (onbekend)',
    amountCents: a.cash,
    op: 'start',
    detail: input.cash.asOf ? `per ${input.cash.asOf}` : undefined,
  })
  if (input.cash.pendingOutCents > 0 || input.cash.pendingInCents > 0) {
    lines.push({
      label: 'In behandeling (niet meegeteld)',
      amountCents: input.cash.pendingInCents - input.cash.pendingOutCents,
      op: 'info',
      detail: `€${eur(input.cash.pendingInCents)} inkomend, €${eur(input.cash.pendingOutCents)} uitgaand`,
    })
  }
  lines.push({
    label: `Verplichtingen (${HORIZON_LABELS[input.horizon]})`,
    amountCents: a.obligationsCents,
    op: '-',
    detail: input.obligations.length === 0 ? 'geen' : input.obligations.map(o => `${o.title} €${eur(o.amountCents)} (${o.dueDate})`).join(' · '),
  })
  lines.push({ label: 'Operationele dekking', amountCents: a.operationalCents, op: '-' })
  lines.push({
    label: 'Salarisdekking eigenaar',
    amountCents: a.salaryCoverageCents,
    op: '-',
    detail: input.ownerSalary.monthlyCents > 0 ? `doel €${eur(input.ownerSalary.monthlyCents)} × ${input.ownerSalary.months} maanden` : undefined,
  })
  lines.push({
    label: 'Gereserveerd voor doelen',
    amountCents: a.goalsCents,
    op: '-',
    detail: input.goals.length === 0 ? 'geen actieve doelen' : input.goals.map(g => `${g.name} €${eur(g.fundedCents)}`).join(' · '),
  })
  lines.push({ label: 'Financiële ruimte vóór veiligheidsmarge', amountCents: a.financialSpaceCents, op: '=' })
  lines.push({ label: 'Gewenste veiligheidsmarge', amountCents: a.safetyMarginCents, op: '-', detail: 'drempel, geen reservering' })
  lines.push({
    label: 'Beschikbaar voor groei',
    amountCents: a.availableForGrowthCents,
    op: '=',
    detail: a.marginShortfallCents > 0 ? `€${eur(a.marginShortfallCents)} onder de gewenste veiligheidsmarge` : undefined,
  })
  return lines
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalizePriority(p?: BucketKey[]): BucketKey[] {
  const seen = new Set<BucketKey>()
  const out: BucketKey[] = []
  for (const k of [...(p ?? []), ...DEFAULT_PRIORITY]) {
    if (!seen.has(k) && DEFAULT_PRIORITY.includes(k)) { seen.add(k); out.push(k) }
  }
  return out
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0)
}

function eur(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(cents / 100))
}

function addDaysISO(d: string, days: number): string {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}
