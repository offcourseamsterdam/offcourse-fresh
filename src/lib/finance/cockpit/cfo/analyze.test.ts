import { describe, it, expect } from 'vitest'
import { formatCfoPrompt } from './prompt'
import { buildFallbackCfoAnalysis, enforceDeterministicMetrics } from './analyze'
import { calculateDeterministicCfoMetrics } from './deterministic-math'
import type { CfoAnalysisDataInputs } from './types'

describe('CFO Analysis Engine', () => {
  const mockInputs: CfoAnalysisDataInputs = {
    asOfDate: '2026-09-13',
    cashClearedCents: 2000000,
    monthlyRevenueCents: 4326375,
    monthlyExpenseCents: 2643349,
    monthlyNetSurplusCents: 1683026,
    ownerSalaryMonthlyCents: 800000,
    expensesByCategory: {
      'Eigenaars (Beer & Jannah)': 800000,
      'Schippers & Crew': 469292,
      'Ligplaatsen Westerdok': 443667,
      'Catering & Wijn': 330743,
      'Partner & Affiliate Commissies': 53573,
    },
    revenuesByChannel: {
      'Eigen Website (Stripe)': 2362549,
      'GetYourGuide': 597864,
      'Viator': 435534,
      'Zettle (Bar)': 274596,
    },
    totalLoanPrincipalCents: 21212500,
    totalLoanOutstandingCents: 21212500,
    loans: [
      {
        name: 'Lening Erik Musegaas',
        lenderName: 'Erik Musegaas',
        principalCents: 8312500,
        interestRatePct: 6,
        durationYears: 5,
        repaymentType: 'linear',
        startDate: '2026-04-01',
        outstandingCents: 8312500,
        nextPayment: {
          dueDate: '2026-10-01',
          totalCents: 249375,
          interestCents: 249375,
          principalCents: 0,
        },
      },
    ],
    upcomingDebtPayments6mCents: 636622,
    upcomingDebtPayments12mCents: 1872800,
    openObligationsTotalCents: 556119,
    openObligationsTop: [
      { title: 'Ligplaats Westerdok', kind: 'mooring', amountCents: 443667, dueDate: '2026-09-30' },
      { title: 'EOC Scheepsverzekering', kind: 'insurance', amountCents: 112452, dueDate: '2026-09-30' },
    ],
    channelAttributions: {
      chatgpt: {
        bookingCount: 7,
        grossRevenueCents: 211500,
        notes: '0% commissie, 100% direct margebehoud via organische AI chat referrals',
      },
      thingsToDoInAmsterdam: {
        bookingCount: 53,
        grossRevenueCents: 1179520,
        commissionCents: 221953,
        netRevenueCents: 957567,
      },
      directWebsite: {
        bookingCount: 65,
        grossRevenueCents: 2362549,
      },
      resellers: {
        getyourguide: { count: 17, grossRevenueCents: 597864 },
        viator: { count: 12, grossRevenueCents: 435534 },
      },
    },
  }

  it('formatCfoPrompt includes all critical financial and marketing context', () => {
    const prompt = formatCfoPrompt(mockInputs)
    expect(prompt).toContain('43.263,75')
    expect(prompt).toContain('212.125')
    expect(prompt).toContain('Erik Musegaas')
    expect(prompt).toContain('chatgpt.com')
    expect(prompt).toContain('Things To Do In Amsterdam')
    expect(prompt).toContain('6.366,22')
    expect(prompt).toContain('Westerdok')
  })

  it('buildFallbackCfoAnalysis returns a fully formed, mathematically grounded result', () => {
    const fallback = buildFallbackCfoAnalysis(mockInputs)

    expect(fallback.headline).toBeDefined()
    expect(fallback.statusLevel).toBe('healthy')
    expect(fallback.solvencyAndDebt.dscr).toBe(3.8)
    expect(fallback.solvencyAndDebt.dscrForward12m).toBe(3.2)
    expect(fallback.solvencyAndDebt.fccr).toBe(2.4)
    expect(fallback.solvencyAndDebt.winterWarChestTargetCents).toBe(2850000)
    expect(fallback.solvencyAndDebt.amortizationCliffYear).toBe(2028)
    expect(fallback.solvencyAndDebt.amortizationCliffAnnualDebtCents).toBe(5587500)

    expect(fallback.maritimeOperations?.revPaxEstimateCents).toBe(320)
    expect(fallback.maritimeOperations?.sinkingFundRecommendedMonthlyCents).toBe(280000)

    expect(fallback.marketingStrategy.stop.length).toBeGreaterThanOrEqual(2)
    expect(fallback.marketingStrategy.start.length).toBeGreaterThanOrEqual(2)
    expect(fallback.marketingStrategy.focus.length).toBeGreaterThanOrEqual(2)
    expect(fallback.marketingStrategy.channelInsights.chatgpt).toContain('ChatGPT')
    expect(fallback.marketingStrategy.channelInsights.thingsToDoInAmsterdam).toContain('Things To Do In Amsterdam')

    expect(fallback.actionPlan.length).toBeGreaterThanOrEqual(3)
    expect(fallback.actionPlan[0].action).toContain('6.366,22')

    expect(fallback.growthPlan10x).toBeDefined()
    expect(fallback.growthPlan10x?.targetRevenueAnnualCents).toBe(400000000)
    expect(fallback.growthPlan10x?.targetFleetSize).toBe(6)
    expect(fallback.growthPlan10x?.pillars.length).toBe(4)
  })

  it('calculateDeterministicCfoMetrics correctly computes DSCR, obligations and CAC', () => {
    const metrics = calculateDeterministicCfoMetrics(mockInputs)
    expect(metrics.totalPrincipalCents).toBe(21212500)
    expect(metrics.octoberInterestDueCents).toBe(636622)
    expect(metrics.amortizationCliffYear).toBe(2028)
    expect(metrics.amortizationCliffAnnualDebtCents).toBe(5587500)
    expect(metrics.trailingDscr).toBe(3.8)
    expect(metrics.forward12mDscr).toBe(3.2)
    expect(metrics.fccr).toBe(2.4)
    expect(metrics.recommendedSinkingFundMonthlyCents).toBe(280000)
    expect(metrics.fbMarginSpreadVerdict).toBe('negative')
  })

  it('enforceDeterministicMetrics guarantees zero hallucination drift by overwriting drifted numbers', () => {
    const metrics = calculateDeterministicCfoMetrics(mockInputs)

    // Simulate an LLM output where the AI hallucinated/drifted numbers
    const hallucinatedResponse: any = {
      headline: 'Hallucinated report',
      statusLevel: 'healthy',
      executiveSummary: 'Some text',
      solvencyAndDebt: {
        dscr: 99.9, // Hallucinated!
        dscrForward12m: 1.1, // Hallucinated!
        fccr: 0.5, // Hallucinated!
        octoberInterestDueCents: 9999999, // Hallucinated!
        amortizationCliffYear: 2035, // Hallucinated!
      },
      marketingStrategy: {
        trueCacPct: 55.0, // Hallucinated!
        hiddenIntermediaryTaxCents: 10000000, // Hallucinated!
      },
    }

    const corrected = enforceDeterministicMetrics(hallucinatedResponse, metrics)

    // Guardrail must have replaced hallucinated values with deterministic ground truth
    expect(corrected.solvencyAndDebt.dscr).toBe(3.8)
    expect(corrected.solvencyAndDebt.dscrForward12m).toBe(3.2)
    expect(corrected.solvencyAndDebt.fccr).toBe(2.4)
    expect(corrected.solvencyAndDebt.octoberInterestDueCents).toBe(636622)
    expect(corrected.solvencyAndDebt.amortizationCliffYear).toBe(2028)
    expect(corrected.solvencyAndDebt.amortizationCliffAnnualDebtCents).toBe(5587500)
    expect(corrected.marketingStrategy.trueCacPct).toBe(metrics.trueCacPct)
    expect(corrected.marketingStrategy.hiddenIntermediaryTaxCents).toBe(metrics.totalHiddenIntermediaryTaxCents)
  })

  it('buildFallbackCfoAnalysis sets modelUsed according to selection', () => {
    const sonnetFallback = buildFallbackCfoAnalysis(mockInputs, 'claude-sonnet-4-6')
    expect(sonnetFallback.modelUsed).toBe('claude-sonnet-4-6')

    const opusFallback = buildFallbackCfoAnalysis(mockInputs, 'claude-opus-4-6')
    expect(opusFallback.modelUsed).toBe('claude-opus-4-6')
  })

  it('correctly calculates and enforces Bezettingspercentage and TOTALREV / cruise', () => {
    const inputsWithOpData: CfoAnalysisDataInputs = {
      ...mockInputs,
      bookingsOperationalData: {
        totalPrivateCruises: 100,
        totalSharedDepartures: 50,
        operatingDaysCount: 50,
        totalPrivateRevCents: 4000000, // € 40.000 -> € 400 per cruise
        totalSharedRevCents: 1500000,  // € 15.000 -> € 300 per departure
        totalSharedGuests: 350,        // 7 guests avg
      },
    }

    const metrics = calculateDeterministicCfoMetrics(inputsWithOpData)
    // 50 days, 10 slots/day = 500 total slots
    // 100 private cruises = 20% occupancy
    // 50 shared departures = 10% occupancy
    expect(metrics.privateOccupancyPct).toBe(20)
    expect(metrics.sharedOccupancyPct).toBe(10)
    expect(metrics.totalOccupancyPct).toBe(30)
    expect(metrics.avgRevPerPrivateCruiseCents).toBe(40000)
    expect(metrics.avgRevPerSharedCruiseCents).toBe(30000)
    expect(metrics.avgGuestsPerSharedCruise).toBe(7)
    expect(metrics.sharedSeatFillPct).toBe(58.3)

    const fallback = buildFallbackCfoAnalysis(inputsWithOpData)
    expect(fallback.maritimeOperations?.privateOccupancyPct).toBe(20)
    expect(fallback.maritimeOperations?.sharedOccupancyPct).toBe(10)
    expect(fallback.maritimeOperations?.avgRevPerPrivateCruiseCents).toBe(40000)
    expect(fallback.maritimeOperations?.avgRevPerSharedCruiseCents).toBe(30000)

    // Verify guardrail overwrite
    const mockLLMResult: any = {
      solvencyAndDebt: {},
      maritimeOperations: {
        privateOccupancyPct: 99.9, // Hallucinated
        avgRevPerPrivateCruiseCents: 1, // Hallucinated
      },
    }
    const enforced = enforceDeterministicMetrics(mockLLMResult, metrics)
    expect(enforced.maritimeOperations?.privateOccupancyPct).toBe(20)
    expect(enforced.maritimeOperations?.avgRevPerPrivateCruiseCents).toBe(40000)
  })
})
