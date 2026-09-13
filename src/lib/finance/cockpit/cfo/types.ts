export interface LoanInfo {
  name: string
  lenderName: string
  principalCents: number
  interestRatePct: number
  durationYears: number
  repaymentType: string
  startDate: string
  outstandingCents: number
  nextPayment: {
    dueDate: string
    totalCents: number
    interestCents: number
    principalCents: number
  } | null
}

export interface ChannelPerformance {
  channel: string
  bookingCount: number
  grossRevenueCents: number
  commissionCents: number
  netRevenueCents: number
  effectiveCommissionPct: number
}

import type { DeterministicCfoMetrics } from './deterministic-math'
export type { DeterministicCfoMetrics }

export interface CfoAnalysisDataInputs {
  asOfDate: string
  cashClearedCents: number
  monthlyRevenueCents: number
  monthlyExpenseCents: number
  monthlyNetSurplusCents: number
  ownerSalaryMonthlyCents: number
  expensesByCategory: Record<string, number>
  revenuesByChannel: Record<string, number>
  totalLoanPrincipalCents: number
  totalLoanOutstandingCents: number
  loans: LoanInfo[]
  upcomingDebtPayments6mCents: number
  upcomingDebtPayments12mCents: number
  openObligationsTotalCents: number
  openObligationsTop: Array<{ title: string; kind: string; amountCents: number; dueDate: string }>
  channelAttributions: {
    chatgpt: { bookingCount: number; grossRevenueCents: number; notes: string }
    thingsToDoInAmsterdam: { bookingCount: number; grossRevenueCents: number; commissionCents: number; netRevenueCents: number }
    directWebsite: { bookingCount: number; grossRevenueCents: number }
    resellers: Record<string, { count: number; grossRevenueCents: number }>
  }
  bookingsOperationalData?: {
    totalPrivateCruises: number
    totalSharedDepartures: number
    operatingDaysCount: number
    totalPrivateRevCents: number
    totalSharedRevCents: number
    totalSharedGuests: number
  }
  deterministicMetrics?: DeterministicCfoMetrics
}

export interface CfoAnalysisResult {
  headline: string
  statusLevel: 'healthy' | 'caution' | 'critical'
  executiveSummary: string
  solvencyAndDebt: {
    dscr: number
    dscrTrailing?: number
    dscrForward12m?: number
    fccr?: number
    status: 'healthy' | 'caution' | 'critical'
    verdict: string
    detailedAnalysis: string
    repaymentCapacityVerdict: string
    winterWarChestTargetCents?: number
    winterWarChestDeficitCents?: number
    octoberInterestDueCents?: number
    amortizationCliffYear?: number
    amortizationCliffAnnualDebtCents?: number
  }
  maritimeOperations?: {
    cmPerHourAssessment: string
    revPaxEstimateCents: number
    fbMarginSpreadVerdict: string
    sinkingFundRecommendedMonthlyCents: number
    sinkingFundCurrentMonthlyCents: number
    fleetOperationalAdvice: string

    // Vlootbezetting t.o.v. boekbare dag-slots & TOTALREV / cruise
    totalBookableSlotsPerDay?: number
    privateOccupancyPct?: number
    sharedOccupancyPct?: number
    totalOccupancyPct?: number
    avgRevPerPrivateCruiseCents?: number
    avgRevPerSharedCruiseCents?: number
    avgGuestsPerSharedCruise?: number
    sharedSeatFillPct?: number
    occupancyVerdict?: string
  }
  marketingStrategy: {
    stop: string[]
    start: string[]
    focus: string[]
    channelInsights: {
      chatgpt: string
      thingsToDoInAmsterdam: string
      directWebsite: string
      resellers: string
    }
    trueCacPct?: number
    hiddenIntermediaryTaxCents?: number
    geoAction?: string
    yieldManagementRule?: string
  }
  costOpportunities: Array<{
    title: string
    potentialSavingCents: number | null
    description: string
  }>
  financialConcerns: Array<{
    title: string
    severity: 'low' | 'medium' | 'high'
    description: string
  }>
  actionPlan: Array<{
    step: number
    action: string
    impact: string
    urgency: 'direct' | 'komende_weken' | 'strategisch'
  }>
  growthPlan10x?: {
    targetRevenueAnnualCents: number
    targetFleetSize: number
    northStarMetric: string
    visionHeadline: string
    pillars: Array<{
      title: string
      multiplier: string
      strategy: string
      annualRevenueContributionCents: number
      executionTactic: string
    }>
    milestones: Array<{
      horizon: string
      targetRevenueMonthlyCents: number
      boatsCount: number
      focus: string
    }>
  }
  analyzedAt: string
  modelUsed?: string
}
