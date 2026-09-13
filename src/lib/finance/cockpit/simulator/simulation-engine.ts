export interface SimulationParams {
  startingCashCents: number
  fleetSize: number // 1 to 6
  occupancyPct: number // e.g. 18 (current) to 75
  scenarioPreset: 'realistic' | 'bull' | 'stress'
  fbSpendPerGuestCents: number // e.g. 300 to 1200
  directBookingRatioPct: number // e.g. 55 to 90
  ownerSalaryMonthlyCents: number // default 800000
  // Expansion scenario (e.g. buying boat 3)
  expansionEnabled: boolean
  expansionMonthIndex: number // 0 to 11 (month in which boat is added)
  expansionCapexCents: number // e.g. 6500000
  expansionFinancingType: 'cash' | 'debt_50' | 'debt_100'
}

export interface MonthlyProjection {
  monthIndex: number
  monthLabel: string
  calendarMonth: number // 1-12
  year: number
  activeBoats: number
  revenueCents: number
  ticketRevenueCents: number
  fbRevenueCents: number
  commissionExpenseCents: number
  variableCostsCents: number // skipper + catering cogs + boat consumables
  fixedOverheadCents: number // Westerdok moorings + EOC insurance + SaaS
  debtServiceInterestCents: number
  debtServicePrincipalCents: number
  ownerSalaryCents: number
  capexCents: number
  netSurplusCents: number
  endingCashCents: number
  dscr: number
  fccr: number
  status: 'healthy' | 'caution' | 'critical'
}

export interface SimulationSummary {
  totalAnnualRevenueCents: number
  totalAnnualNetSurplusCents: number
  totalAnnualDebtServiceCents: number
  minimumCashCents: number
  minimumCashMonth: string
  averageDscr: number
  endingCash12mCents: number
  projections: MonthlyProjection[]
  cfoVerdict: {
    canAffordExpansion: boolean
    verdictTitle: string
    verdictDescription: string
    recommendations: string[]
  }
}

// Amsterdam canal seasonality index (1.0 = average month)
// Peaks in June-August; Light Festival lift in Dec-Jan
const SEASONALITY_WEIGHTS: Record<number, number> = {
  1: 0.65, // Jan (Light Festival wraps up)
  2: 0.55, // Feb (coldest trough)
  3: 0.75, // Mar (start of spring)
  4: 1.10, // Apr (King's Day, tulip season)
  5: 1.25, // May (Ascension, spring peak)
  6: 1.40, // Jun (midsummer peak)
  7: 1.45, // Jul (high summer vacation)
  8: 1.45, // Aug (pride, high summer)
  9: 1.20, // Sep (late summer pleasant)
  10: 0.95, // Oct (ADE / autumn)
  11: 0.70, // Nov (start Light Festival)
  12: 0.85, // Dec (Light Festival & holiday parties)
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec',
]

/**
 * Runs deterministic 12-month projections starting from September 2026.
 */
export function run12MonthSimulation(params: SimulationParams): SimulationSummary {
  const projections: MonthlyProjection[] = []
  let currentCash = params.startingCashCents

  // Weather/scenario multiplier
  const scenarioMultiplier =
    params.scenarioPreset === 'bull'
      ? 1.15
      : params.scenarioPreset === 'stress'
        ? 0.75
        : 1.0

  const startMonth = 9 // September (1-indexed)
  const startYear = 2026

  let totalRevenue = 0
  let totalSurplus = 0
  let totalDebtService = 0
  let minCash = currentCash
  let minCashMonth = 'Sep 2026'
  let dscrSum = 0

  for (let i = 0; i < 12; i++) {
    const calendarMonth = ((startMonth - 1 + i) % 12) + 1
    const year = startYear + Math.floor((startMonth - 1 + i) / 12)
    const monthLabel = `${MONTH_NAMES[calendarMonth - 1]} ${year}`

    // Determine fleet size this month
    let activeBoats = params.fleetSize
    let capexThisMonth = 0
    if (params.expansionEnabled && i >= params.expansionMonthIndex) {
      activeBoats = params.fleetSize + 1
      if (i === params.expansionMonthIndex) {
        if (params.expansionFinancingType === 'cash') {
          capexThisMonth = params.expansionCapexCents
        } else if (params.expansionFinancingType === 'debt_50') {
          capexThisMonth = params.expansionCapexCents * 0.5
        } else {
          capexThisMonth = 0 // 100% financed
        }
      }
    }

    // Capacity & Revenue Model:
    // 1 boat has 5 bookable slots per day * 30 days = 150 slots/month
    // Total fleet bookable slots/month = activeBoats * 150
    const totalFleetSlots = activeBoats * 150
    const bookedSlots = Math.round(totalFleetSlots * (params.occupancyPct / 100))

    // Base ticket price average: € 285 (mix of € 345 private charter and shared seats)
    const seasonality = SEASONALITY_WEIGHTS[calendarMonth] ?? 1.0
    const baseTicketRevPerSlot = 28500 // cents
    const ticketRevenue = Math.round(bookedSlots * baseTicketRevPerSlot * seasonality * scenarioMultiplier)

    // Guests: average 7 guests per cruise
    const totalGuests = bookedSlots * 7
    const fbRevenue = Math.round(totalGuests * params.fbSpendPerGuestCents)
    const grossRevenue = ticketRevenue + fbRevenue

    // Commissions (OTAs vs Direct)
    // Non-direct portion pays average 21% commission
    const otaRatio = (100 - params.directBookingRatioPct) / 100
    const commissionExpense = Math.round(ticketRevenue * otaRatio * 0.21)

    // Variable costs:
    // Skipper: € 45/hr * 1.5 hr per cruise = € 67.50 per cruise
    // Catering COGS: ~25% of F&B revenue
    // Consumables/cleaning: € 15 per cruise
    const variableCosts = Math.round(bookedSlots * 6750 + fbRevenue * 0.25 + bookedSlots * 1500)

    // Fixed overhead:
    // Westerdok berth: € 2.218 per boat per month
    // EOC Insurance: € 562 per boat per month
    // SaaS, accounting, base overhead: € 2.300 fixed
    const fixedOverhead = Math.round(activeBoats * (221800 + 56200) + 230000)

    // Exact Debt Service Schedule for Off Course:
    // October 2026: Interest payment of € 6.366,22
    // April 2027: Tijs Louman principal bullet (€ 6.000) + half-year interest (€ 6.362) = € 12.362
    // If expansion debt added, add debt service
    let debtInterest = 0
    let debtPrincipal = 0

    if (calendarMonth === 10 && year === 2026) {
      debtInterest = 636622
      debtPrincipal = 0
    } else if (calendarMonth === 4 && year === 2027) {
      debtInterest = 636200
      debtPrincipal = 600000 // Tijs Louman bullet
    }

    if (params.expansionEnabled && i >= params.expansionMonthIndex && params.expansionFinancingType !== 'cash') {
      const financedAmount =
        params.expansionFinancingType === 'debt_50' ? params.expansionCapexCents * 0.5 : params.expansionCapexCents
      // 6% interest monthly
      debtInterest += Math.round((financedAmount * 0.06) / 12)
    }

    const totalOperatingCosts = commissionExpense + variableCosts + fixedOverhead
    const operatingSurplus = grossRevenue - totalOperatingCosts
    const netSurplus = operatingSurplus - debtInterest - debtPrincipal - params.ownerSalaryMonthlyCents - capexThisMonth

    currentCash += netSurplus

    if (currentCash < minCash) {
      minCash = currentCash
      minCashMonth = monthLabel
    }

    // DSCR = (Operating Surplus) / (Debt Service)
    const totalDebtServiceThisMonth = debtInterest + debtPrincipal
    const monthlyDscr =
      totalDebtServiceThisMonth > 0
        ? Number((operatingSurplus / totalDebtServiceThisMonth).toFixed(2))
        : 4.5 // no debt service this month -> healthy

    // Fixed Charge Coverage Ratio
    const fixedCharges = fixedOverhead + totalDebtServiceThisMonth
    const fccr = fixedCharges > 0 ? Number(((grossRevenue - variableCosts - commissionExpense) / fixedCharges).toFixed(2)) : 3.0

    const status = currentCash < 500000 ? 'critical' : currentCash < 1500000 ? 'caution' : 'healthy'

    projections.push({
      monthIndex: i,
      monthLabel,
      calendarMonth,
      year,
      activeBoats,
      revenueCents: grossRevenue,
      ticketRevenueCents: ticketRevenue,
      fbRevenueCents: fbRevenue,
      commissionExpenseCents: commissionExpense,
      variableCostsCents: variableCosts,
      fixedOverheadCents: fixedOverhead,
      debtServiceInterestCents: debtInterest,
      debtServicePrincipalCents: debtPrincipal,
      ownerSalaryCents: params.ownerSalaryMonthlyCents,
      capexCents: capexThisMonth,
      netSurplusCents: netSurplus,
      endingCashCents: currentCash,
      dscr: monthlyDscr,
      fccr,
      status,
    })

    totalRevenue += grossRevenue
    totalSurplus += netSurplus
    totalDebtService += totalDebtServiceThisMonth
    dscrSum += monthlyDscr
  }

  const avgDscr = Number((dscrSum / 12).toFixed(2))

  // CFO intelligent verdict based on outcomes
  const canAfford = minCash >= 1000000 // keeps at least € 10k safety cushion
  const isComfortable = minCash >= 2500000

  let verdictTitle = ''
  let verdictDescription = ''
  const recommendations: string[] = []

  if (isComfortable) {
    verdictTitle = 'Groen Licht: Uitstekende Financiële Ruimte & Solide Runway'
    verdictDescription = `Met dit scenario bereikt Off Course een jaaromzet van € ${(totalRevenue / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2 })} en sluit de 12-maands periode af met € ${(currentCash / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2 })} op de bank. Het laagste kassaldo bedraagt € ${(minCash / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2 })} in ${minCashMonth}.`
  } else if (canAfford) {
    verdictTitle = 'Haalbaar met Waakzaamheid: Veiligheidsmarge Behouden'
    verdictDescription = `Dit scenario is operationeel haalbaar met een laagste kassaldo van € ${(minCash / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2 })} in ${minCashMonth}. Let op: de leningbetaling in april 2027 vereist tijdige reservering.`
  } else {
    verdictTitle = 'Risicovol Scenario: Liquiditeitsdruk in het Laagseizoen'
    verdictDescription = `In dit scenario zakt het kassaldo naar een kritiek dieptepunt van € ${(minCash / 100).toLocaleString('nl-NL', { minimumFractionDigits: 2 })} in ${minCashMonth}. Pas de bezetting aan of spreid de investering.`
  }

  if (params.expansionEnabled) {
    if (canAfford) {
      recommendations.push(`Boot 3 toevoegen in maand ${params.expansionMonthIndex + 1} genereert extra schaalkracht zonder solvabiliteitsrisico.`)
    } else {
      recommendations.push(`Stel de aankoop van boot 3 uit naar mei 2027 of kies voor 100% asset-backed scheepshypotheek i.p.v. cash.`)
    }
  }

  if (params.directBookingRatioPct < 70) {
    recommendations.push(`Verhoog het directe website-aandeel naar 75%+ via GEO en WhatsApp loyaliteit om jaarlijks provisies te besparen.`)
  }

  if (params.fbSpendPerGuestCents < 600) {
    recommendations.push(`Verhoog de onboard F&B spend naar € 7,50+ per gast via samengestelde drank- en borrelarrangementen; dit levert direct extra winst op.`)
  }

  return {
    totalAnnualRevenueCents: totalRevenue,
    totalAnnualNetSurplusCents: totalSurplus,
    totalAnnualDebtServiceCents: totalDebtService,
    minimumCashCents: minCash,
    minimumCashMonth: minCashMonth,
    averageDscr: avgDscr,
    endingCash12mCents: currentCash,
    projections,
    cfoVerdict: {
      canAffordExpansion: canAfford,
      verdictTitle,
      verdictDescription,
      recommendations,
    },
  }
}
