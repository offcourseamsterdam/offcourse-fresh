import { calculateCateringOrderCosts, resolveItemCostPrice, type ExtraCatalogItem } from './catering-costs'

export interface LoanItem {
  id: string
  name: string // e.g. 'Bootfinanciering Curaçao'
  principalTotalCents: number // e.g. 2500000 (€ 25.000)
  monthlyPrincipalCents: number // e.g. 50000 (€ 500 / mnd)
  monthlyInterestCents: number // e.g. 11500 (€ 115 / mnd)
  interestRatePct: number // e.g. 5.5%
  targetPayoffYear?: number // e.g. 2028
}

export interface AlfCategorySetting {
  id: string
  name: string // e.g. 'Categorie 1: Curaçao (Overkapt / Salon)'
  active: boolean // Toggle ON/OFF
  feeCents: number // default 190000 (€ 1.900)
  targetCruises?: number // e.g. 8 cruises
  ticketPriceCents?: number // e.g. 3500 (€ 35)
}

export interface FixedCostItem {
  id: string
  name: string
  monthlyCents: number
}

export const DEFAULT_FIXED_COST_ITEMS: FixedCostItem[] = [
  { id: 'fc-phone', name: 'Telefoon & Mobiele Data', monthlyCents: 4500 },
  { id: 'fc-software', name: 'Software & Tools (Vercel, Google, AI)', monthlyCents: 12000 },
  { id: 'fc-admin', name: 'Boekhouding & Administratie', monthlyCents: 18000 },
  { id: 'fc-insurance', name: 'Boot- & Bedrijfsverzekering', monthlyCents: 25000 },
]

export interface CockpitBudgetSettings {
  maintenancePct: number // default 8
  marketingPct: number // default 6
  profitFirstProfitPct: number // default 5 (5% van omzet direct naar winstrekening)
  ownerSalaryMonthlyCents: number // default 350000 (€ 3.500 / maand)
  ownerSalaryPct: number // default 0 (of als % van omzet)
  boatCount: number // default 2
  berthFeePerBoatYearlyCents: number // default 400000 (€ 4.000 ex BTW per boot per jaar)
  otherFixedCostsMonthlyCents: number // default 120000 (€ 1.200 / maand)
  fixedCostItems?: FixedCostItem[] // Itemized vaste kosten (zoals telefoonabonnement)
  zettleCogsPct: number // default 28 (28% inkoop op boordverkoop)
  // Multi-loans
  loans?: LoanItem[]
  // Legacy single loan fallback
  loanName: string // default 'Bootfinanciering'
  loanPrincipalTotalCents: number // default 4000000 (€ 40.000)
  loanMonthlyPrincipalCents: number // default 75000 (€ 750 / maand aflossing)
  loanMonthlyInterestCents: number // default 17500 (€ 175 / maand rente)
  loanInterestRatePct: number // default 5.5%
  loanTargetPayoffYear: number // default 2028
  // Scenario planning & What-if
  marketingScenarioSpendCents?: number // default 200000 (€ 2.000 baseline)
  marketingScenarioMode?: 'fixed_cents' | 'percentage' // default 'fixed_cents'
  alfCategories?: AlfCategorySetting[]
  fixedCostsMonthlyCents: number // legacy fallback
  winterBufferTargetCents: number // default 2500000 (€ 25.000)
  defaultMonthlyRevenueTargetCents: number // default 4000000 (€ 40.000)
  targetSkipperRatioPct: number // default 18
  targetCateringMarginPct: number // default 55
  defaultSkipperHourlyRateCents: number // default 3500 (€ 35/h)
}

export const DEFAULT_ALF_CATEGORIES: AlfCategorySetting[] = [
  { id: 'alf-1', name: 'Categorie 1: Curaçao (Overkapt / Salon)', active: true, feeCents: 190000, targetCruises: 8, ticketPriceCents: 3500 },
  { id: 'alf-2', name: 'Categorie 2: Tweede Boot (Open / Semi)', active: false, feeCents: 190000, targetCruises: 6, ticketPriceCents: 3500 },
]

export const DEFAULT_LOANS: LoanItem[] = [
  {
    id: 'loan-1',
    name: 'Bootfinanciering Curaçao',
    principalTotalCents: 4000000,
    monthlyPrincipalCents: 75000,
    monthlyInterestCents: 17500,
    interestRatePct: 5.5,
    targetPayoffYear: 2028,
  },
]

export const DEFAULT_BUDGET_SETTINGS: CockpitBudgetSettings = {
  maintenancePct: 8.0,
  marketingPct: 6.0,
  profitFirstProfitPct: 5.0,
  ownerSalaryMonthlyCents: 350000,
  ownerSalaryPct: 0.0,
  boatCount: 2,
  berthFeePerBoatYearlyCents: 400000,
  otherFixedCostsMonthlyCents: 120000,
  fixedCostItems: DEFAULT_FIXED_COST_ITEMS,
  zettleCogsPct: 28.0,
  loans: DEFAULT_LOANS,
  loanName: 'Bootfinanciering Curaçao',
  loanPrincipalTotalCents: 4000000,
  loanMonthlyPrincipalCents: 75000,
  loanMonthlyInterestCents: 17500,
  loanInterestRatePct: 5.5,
  loanTargetPayoffYear: 2028,
  marketingScenarioSpendCents: 200000,
  marketingScenarioMode: 'fixed_cents',
  alfCategories: DEFAULT_ALF_CATEGORIES,
  fixedCostsMonthlyCents: 186667,
  winterBufferTargetCents: 2500000,
  defaultMonthlyRevenueTargetCents: 4000000,
  targetSkipperRatioPct: 18.0,
  targetCateringMarginPct: 55.0,
  defaultSkipperHourlyRateCents: 3500,
}

export interface BookingForCockpit {
  id: string
  booking_date: string | null
  status: string | null
  booking_source?: string | null
  stripe_amount?: number | null
  base_amount_cents?: number | null
  extras_amount_cents?: number | null
  commission_amount_cents?: number | null
  guest_count?: number | null
  extras_selected?: unknown
}

export interface ShiftForCockpit {
  id: string
  date: string
  start_at: string
  end_at: string
  staff_id: string | null
  booking_id: string | null
  status: string
  staff?: {
    hourly_rate_cents?: number | null
  } | null
}

export interface ZettleMonthForCockpit {
  month: string // '2026-08-01'
  total_incl_vat_cents?: number | null
  total_excl_vat_cents?: number | null
  card_gross_cents?: number | null
  cash_zettle_cents?: number | null
  vat9_vat_cents?: number | null
  vat21_vat_cents?: number | null
  total_vat_cents?: number | null
}

export interface MonthlyCockpitRow {
  month: string // '2026-08'
  monthLabel: string // 'Aug 2026'
  bookingCount: number
  totalRevenueCents: number
  channelCommissionCents: number
  cityTaxCents: number
  // Catering & Bar (incl Zettle boordverkoop)
  cateringSellingCents: number
  cateringCostCents: number
  cateringMarginCents: number
  cateringMarginPct: number
  ticketCateringSellingCents: number
  ticketCateringCostCents: number
  zettleSellingCents: number
  zettleCostCents: number
  // Schippers
  skipperCostCents: number
  skipperHours: number
  skipperRatioPct: number
  // Winst voor vaste lasten (Operationele marge)
  operatingProfitCents: number
  operatingProfitPct: number
  profitPerHourCents: number
  // Vaste lasten
  berthFeeMonthlyCents: number // Liggeld (€ 4.000 / 12 per boot)
  otherFixedCostsMonthlyCents: number
  totalFixedCostsCents: number
  // Lening & Financiering (Rente + Aflossing)
  loanInterestCents: number
  loanPrincipalCents: number
  totalDebtServiceCents: number
  remainingLoanPrincipalCents: number
  // Profit First toewijzingen
  profitFirstProfitPotCents: number // Directe winstreservering
  ownerSalaryPotCents: number // Eigenaarsbeloning
  maintenancePotCents: number // 8% Capex
  marketingPotCents: number // 6% Groei
  fiscusReserveCents: number // BTW + City Tax
  // ── 3-TIER KOSTENHIËRARCHIE ──
  // Tier 3: Variabele vaartkosten (COGS, catering, drank, captains, commissies, city tax)
  tier3VariableCostsCents: number
  grossContributionMarginCents: number // Totale omzet - Tier 3 (Dekkingsbijdrage)
  grossContributionMarginPct: number

  // Tier 1: Vaste kosten (Operationeel fundament: liggeld, vaste overhead, eigenaarsbasis, leningrente)
  tier1FixedCostsCents: number
  operatingCashFlowCents: number // Dekkingsbijdrage - Tier 1

  // Tier 2: Dynamische kosten & Investeringen (Profit First & Groei: aflossing, onderhoudsreserve, marketing, ALF)
  tier2InvestmentsCents: number
  netRetainedCashCents: number // Operating Cash Flow - Tier 2 (Echte vrije overcash)

  alfFeesMonthlyCents: number
  marketingSpendMonthlyCents: number

  // Netto overblijvende vrije cash na alle potjes, vaste lasten en leningaflossing
  netFreeCashAfterPotsCents: number
  profitFirstHealth: 'healthy' | 'tight' | 'deficit'
  // Target comparisons
  revenueTargetCents: number
  revenueTargetProgressPct: number
  isCurrentMonth: boolean
}

export interface LoanSummaryItem {
  id: string
  name: string
  principalTotalCents: number
  monthlyPrincipalCents: number
  monthlyInterestCents: number
  interestRatePct: number
  remainingPrincipalCents: number
  monthsUntilPaidOff: number
}

export interface CockpitTotals {
  totalRevenueCents: number
  totalOperatingProfitCents: number
  overallProfitMarginPct: number
  totalSkipperCostCents: number
  overallSkipperRatioPct: number
  totalCateringSellingCents: number
  totalCateringCostCents: number
  overallCateringMarginPct: number
  totalZettleSellingCents: number
  totalFixedCostsCents: number
  totalBerthFeeCents: number
  totalOwnerSalaryCents: number
  totalProfitFirstProfitCents: number
  totalLoanInterestCents: number
  totalLoanPrincipalCents: number
  totalDebtServiceCents: number
  remainingLoanPrincipalCents: number
  monthsUntilDebtFree: number
  totalMaintenanceReservedCents: number
  totalMarketingBudgetCents: number
  totalHoursCruised: number
  averageProfitPerHourCents: number

  // 3-Tier Totals
  totalTier3VariableCostsCents: number
  totalGrossContributionMarginCents: number
  overallGrossContributionMarginPct: number

  totalTier1FixedCostsCents: number
  totalOperatingCashFlowCents: number

  totalTier2InvestmentsCents: number
  totalNetRetainedCashCents: number

  // Multi-Loan Summaries
  loansSummary: LoanSummaryItem[]

  // Scenario Simulator Outputs
  marketingScenario: {
    baselineSpendCents: number // 200.000 (€ 2.000)
    activeSpendCents: number // e.g. 400.000 (€ 4.000)
    deltaSpendCents: number // +200.000
    breakevenCruisesNeeded: number // e.g. 7.7
    projectedExtraBookings: number // e.g. 13
    projectedNetExtraProfitCents: number
  }

  alfScenario: {
    totalActiveCategories: number
    totalFeesCents: number
    categories: Array<{
      id: string
      name: string
      active: boolean
      feeCents: number
      breakevenCruises: number
      breakevenTickets: number
    }>
    breakevenTotalCruises: number
  }

  // Investerings-Thermometer & Stoplicht
  investmentGauge: {
    freeInvestmentCapacityCents: number
    status: 'green' | 'orange' | 'red'
    canInvest4kMarketing: boolean
    canInvestAlf: boolean
    recommendationText: string
  }
  fixedCostItems: FixedCostItem[]
}

const DUTCH_MONTH_NAMES = [
  'Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'
]

export function buildYearMonthKeys(year: number): string[] {
  const keys: string[] = []
  for (let m = 1; m <= 12; m++) {
    keys.push(`${year}-${String(m).padStart(2, '0')}`)
  }
  return keys
}

export function computeMonthlyCockpit({
  year,
  bookings,
  shifts,
  zettleMonths = [],
  catalog,
  settings = DEFAULT_BUDGET_SETTINGS,
  currentDate = new Date(),
}: {
  year: number
  bookings: BookingForCockpit[]
  shifts: ShiftForCockpit[]
  zettleMonths?: ZettleMonthForCockpit[]
  catalog?: ExtraCatalogItem[] | null
  settings?: CockpitBudgetSettings
  currentDate?: Date
}): { months: MonthlyCockpitRow[]; totals: CockpitTotals } {
  const monthKeys = buildYearMonthKeys(year)
  const currentMonthKey = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`

  // Group shifts by month
  const shiftsByMonth: Record<string, ShiftForCockpit[]> = {}
  for (const s of shifts) {
    const m = s.date?.slice(0, 7) || s.start_at?.slice(0, 7)
    if (m && m.startsWith(String(year))) {
      if (!shiftsByMonth[m]) shiftsByMonth[m] = []
      shiftsByMonth[m].push(s)
    }
  }

  // Group bookings by month
  const bookingsByMonth: Record<string, BookingForCockpit[]> = {}
  for (const b of bookings) {
    if (b.status === 'cancelled') continue
    const m = b.booking_date?.slice(0, 7)
    if (m && m.startsWith(String(year))) {
      if (!bookingsByMonth[m]) bookingsByMonth[m] = []
      bookingsByMonth[m].push(b)
    }
  }

  // Group Zettle by month
  const zettleByMonth: Record<string, ZettleMonthForCockpit> = {}
  for (const z of zettleMonths) {
    if (!z.month) continue
    const m = z.month.slice(0, 7)
    if (m && m.startsWith(String(year))) {
      zettleByMonth[m] = z
    }
  }

  // Fixed Cost items resolution (Abonnementen zoals telefoon, software, etc.):
  const hasCustomFixedItems = Boolean(
    settings.fixedCostItems &&
    settings.fixedCostItems !== DEFAULT_FIXED_COST_ITEMS &&
    settings.fixedCostItems.length > 0
  )
  const activeFixedCostItems: FixedCostItem[] = hasCustomFixedItems
    ? settings.fixedCostItems!
    : DEFAULT_FIXED_COST_ITEMS
  const monthlyOtherFixedCostsCents = hasCustomFixedItems
    ? activeFixedCostItems.reduce((sum, item) => sum + item.monthlyCents, 0)
    : (settings.otherFixedCostsMonthlyCents ?? activeFixedCostItems.reduce((sum, item) => sum + item.monthlyCents, 0))

  // Liggeld: 1/4 (25%) opzij zetten in oktober (9), november (10), februari (1) en maart (2)
  const totalFleetBerthFeeYearlyCents = settings.boatCount * settings.berthFeePerBoatYearlyCents
  const quarterlyBerthFeeCents = Math.round(totalFleetBerthFeeYearlyCents / 4)

  // Multi-loans resolution (falls back to legacy single loan if loans array is empty)
  const activeLoans: LoanItem[] = (settings.loans && settings.loans.length > 0)
    ? settings.loans
    : [
        {
          id: 'default-loan',
          name: settings.loanName || 'Bootfinanciering Curaçao',
          principalTotalCents: settings.loanPrincipalTotalCents ?? 4000000,
          monthlyPrincipalCents: settings.loanMonthlyPrincipalCents ?? 75000,
          monthlyInterestCents: settings.loanMonthlyInterestCents ?? 17500,
          interestRatePct: settings.loanInterestRatePct ?? 5.5,
          targetPayoffYear: settings.loanTargetPayoffYear ?? 2028,
        },
      ]

  const monthlyLoanPrincipalCents = activeLoans.reduce((sum, l) => sum + l.monthlyPrincipalCents, 0)
  const monthlyLoanInterestCents = activeLoans.reduce((sum, l) => sum + l.monthlyInterestCents, 0)
  const monthlyTotalDebtServiceCents = monthlyLoanPrincipalCents + monthlyLoanInterestCents
  const initialTotalLoanPrincipalCents = activeLoans.reduce((sum, l) => sum + l.principalTotalCents, 0)

  // ALF resolution (Amsterdam Light Festival: December & January)
  const alfCategories = settings.alfCategories && settings.alfCategories.length > 0
    ? settings.alfCategories
    : DEFAULT_ALF_CATEGORIES
  const totalActiveAlfFeesCents = alfCategories
    .filter(c => c.active)
    .reduce((sum, c) => sum + c.feeCents, 0)

  let totalRevenueCents = 0
  let totalOperatingProfitCents = 0
  let totalSkipperCostCents = 0
  let totalCateringSellingCents = 0
  let totalCateringCostCents = 0
  let totalZettleSellingCents = 0
  let totalMaintenanceReservedCents = 0
  let totalMarketingBudgetCents = 0
  let totalProfitFirstProfitCents = 0
  let totalOwnerSalaryCents = 0
  let totalLoanInterestCents = 0
  let totalLoanPrincipalCents = 0
  let totalHoursCruised = 0
  let totalBookingCount = 0

  let totalTier3VariableCostsCents = 0
  let totalGrossContributionMarginCents = 0
  let totalTier1FixedCostsCents = 0
  let totalOperatingCashFlowCents = 0
  let totalTier2InvestmentsCents = 0
  let totalNetRetainedCashCents = 0

  let cumulativePrincipalRepaid = 0

  const months: MonthlyCockpitRow[] = monthKeys.map((mKey, idx) => {
    const monthIndex = parseInt(mKey.slice(5, 7), 10) - 1
    const monthLabel = `${DUTCH_MONTH_NAMES[monthIndex]} ${year}`
    const bList = bookingsByMonth[mKey] || []
    const sList = shiftsByMonth[mKey] || []
    const zData = zettleByMonth[mKey]

    // Liggeld: Beer's regel: 1/4 opzij zetten in oktober (index 9), november (index 10), februari (index 1) en maart (index 2)
    // om het recht te trekken met de rest van het jaar
    const isBerthFeeSavingsMonth = (monthIndex === 9 || monthIndex === 10 || monthIndex === 1 || monthIndex === 2)
    const berthFeeMonthlyCents = isBerthFeeSavingsMonth ? quarterlyBerthFeeCents : 0
    const monthlyTotalFixedCostsCents = berthFeeMonthlyCents + monthlyOtherFixedCostsCents

    let bookingRevCents = 0
    let commissionCents = 0
    let guestCount = 0
    let ticketCatSell = 0
    let ticketCatCost = 0

    for (const b of bList) {
      const bookingRev = typeof b.stripe_amount === 'number' && b.stripe_amount > 0
        ? b.stripe_amount
        : (b.base_amount_cents || 0) + (b.extras_amount_cents || 0)
      bookingRevCents += bookingRev

      commissionCents += b.commission_amount_cents || 0
      guestCount += b.guest_count || 0

      const catRes = calculateCateringOrderCosts(
        b.extras_selected as Array<{ name: string; amount_cents: number; quantity?: number; category?: string }>,
        catalog
      )
      ticketCatSell += catRes.sellingCents
      ticketCatCost += catRes.costCents
    }

    // Zettle onboard catering / drinks
    let zettleSell = 0
    let zettleCost = 0
    let zettleVat = 0
    if (zData) {
      zettleSell = zData.total_incl_vat_cents ?? ((zData.card_gross_cents ?? 0) + (zData.cash_zettle_cents ?? 0))
      zettleCost = Math.round(zettleSell * (settings.zettleCogsPct / 100))
      zettleVat = zData.total_vat_cents ?? 0
    }

    // Totale omzet (boekingen + Zettle boordomzet)
    const revCents = bookingRevCents + zettleSell

    // Totale Catering (tickets + Zettle)
    const cateringSell = ticketCatSell + zettleSell
    const cateringCost = ticketCatCost + zettleCost
    const cateringMarginCents = Math.max(0, cateringSell - cateringCost)
    const cateringMarginPct = cateringSell > 0 ? Math.round((cateringMarginCents / cateringSell) * 100) : 0

    // City Tax (€ 2,60 / guest)
    const cityTaxCents = guestCount * 260

    // Skipper costs & hours from shifts
    let mSkipperCost = 0
    let mHours = 0
    for (const s of sList) {
      if (s.status === 'cancelled') continue
      const start = new Date(s.start_at).getTime()
      const end = new Date(s.end_at).getTime()
      const hours = Math.max(0, (end - start) / 3600000)
      mHours += hours

      const rate = s.staff?.hourly_rate_cents && s.staff.hourly_rate_cents > 0
        ? s.staff.hourly_rate_cents
        : settings.defaultSkipperHourlyRateCents
      mSkipperCost += Math.round(hours * rate)
    }

    // ── 3-TIER KOSTENHIËRARCHIE ──

    // Tier 3: Variabele Vaartkosten (COGS, catering, drank, schippers, commissies, city tax)
    const tier3VariableCostsCents = commissionCents + cityTaxCents + cateringCost + mSkipperCost
    const grossContributionMarginCents = revCents - tier3VariableCostsCents
    const grossContributionMarginPct = revCents > 0 ? Math.round((grossContributionMarginCents / revCents) * 100) : 0

    // Operating Profit (gelijk aan gross contribution margin voor compatibiliteit)
    const operatingProfitCents = grossContributionMarginCents
    const operatingProfitPct = grossContributionMarginPct
    const profitPerHourCents = mHours > 0 ? Math.round(operatingProfitCents / mHours) : 0
    const skipperRatioPct = revCents > 0 ? Math.round((mSkipperCost / revCents) * 100) : 0

    // Multi-loan Debt service for this month
    cumulativePrincipalRepaid += monthlyLoanPrincipalCents
    const remainingLoanPrincipalCents = Math.max(0, initialTotalLoanPrincipalCents - cumulativePrincipalRepaid)

    // Profit First & Vaste reserveringen:
    // 1. Eigenaarssalaris (vast bedrag of % van omzet)
    const ownerSalaryPotCents = settings.ownerSalaryPct > 0
      ? Math.round(revCents * (settings.ownerSalaryPct / 100))
      : settings.ownerSalaryMonthlyCents

    // 2. Tier 1: Vaste Kosten (Fundament: liggeld + overhead + eigenaar minimum + rente)
    const tier1FixedCostsCents = monthlyTotalFixedCostsCents + ownerSalaryPotCents + monthlyLoanInterestCents
    const operatingCashFlowCents = grossContributionMarginCents - tier1FixedCostsCents

    // 3. Profit First Pot (direct 5-10% afromen)
    const profitFirstProfitPotCents = Math.round(revCents * (settings.profitFirstProfitPct / 100))

    // 4. Vloot & Onderhoudsreserve (8%)
    const maintenancePotCents = Math.round(revCents * (settings.maintenancePct / 100))

    // 5. Marketing & Groeibudget (What-if scenario spend of percentage)
    const marketingSpendMonthlyCents = settings.marketingScenarioSpendCents !== undefined
      ? settings.marketingScenarioSpendCents
      : Math.round(revCents * (settings.marketingPct / 100))

    // 6. Amsterdam Light Festival (Dec & Jan)
    // 50% in December (index 11), 50% in January (index 0)
    const alfFeesMonthlyCents = (monthIndex === 11 || monthIndex === 0)
      ? Math.round(totalActiveAlfFeesCents / 2)
      : 0

    // 7. Belastingreservering (BTW + City Tax + Zettle BTW)
    const fiscusReserveCents = Math.round(cityTaxCents + (bookingRevCents * 0.09) + zettleVat)

    // Tier 2: Dynamische kosten & Investeringen (Aflossing leningen + onderhoudsreservering + marketing + ALF + winstpot)
    const tier2InvestmentsCents = monthlyLoanPrincipalCents + maintenancePotCents + marketingSpendMonthlyCents + alfFeesMonthlyCents + profitFirstProfitPotCents
    const netRetainedCashCents = operatingCashFlowCents - tier2InvestmentsCents
    const netFreeCashAfterPotsCents = netRetainedCashCents

    // Profit First Health Check
    let profitFirstHealth: 'healthy' | 'tight' | 'deficit' = 'healthy'
    if (netFreeCashAfterPotsCents < 0) {
      profitFirstHealth = netFreeCashAfterPotsCents < -100000 ? 'deficit' : 'tight'
    }

    // Revenue target
    const target = settings.defaultMonthlyRevenueTargetCents
    const targetProgressPct = target > 0 ? Math.min(100, Math.round((revCents / target) * 100)) : 0

    // Accumulate totals
    totalRevenueCents += revCents
    totalOperatingProfitCents += operatingProfitCents
    totalSkipperCostCents += mSkipperCost
    totalCateringSellingCents += cateringSell
    totalCateringCostCents += cateringCost
    totalZettleSellingCents += zettleSell
    totalMaintenanceReservedCents += maintenancePotCents
    totalMarketingBudgetCents += marketingSpendMonthlyCents
    totalProfitFirstProfitCents += profitFirstProfitPotCents
    totalOwnerSalaryCents += ownerSalaryPotCents
    totalLoanInterestCents += monthlyLoanInterestCents
    totalLoanPrincipalCents += monthlyLoanPrincipalCents
    totalHoursCruised += mHours
    totalBookingCount += bList.length

    totalTier3VariableCostsCents += tier3VariableCostsCents
    totalGrossContributionMarginCents += grossContributionMarginCents
    totalTier1FixedCostsCents += tier1FixedCostsCents
    totalOperatingCashFlowCents += operatingCashFlowCents
    totalTier2InvestmentsCents += tier2InvestmentsCents
    totalNetRetainedCashCents += netRetainedCashCents

    return {
      month: mKey,
      monthLabel,
      bookingCount: bList.length,
      totalRevenueCents: revCents,
      channelCommissionCents: commissionCents,
      cityTaxCents,
      cateringSellingCents: cateringSell,
      cateringCostCents: cateringCost,
      cateringMarginCents,
      cateringMarginPct,
      ticketCateringSellingCents: ticketCatSell,
      ticketCateringCostCents: ticketCatCost,
      zettleSellingCents: zettleSell,
      zettleCostCents: zettleCost,
      skipperCostCents: mSkipperCost,
      skipperHours: Math.round(mHours * 10) / 10,
      skipperRatioPct,
      operatingProfitCents,
      operatingProfitPct,
      profitPerHourCents,
      berthFeeMonthlyCents,
      otherFixedCostsMonthlyCents: monthlyOtherFixedCostsCents,
      totalFixedCostsCents: monthlyTotalFixedCostsCents,
      loanInterestCents: monthlyLoanInterestCents,
      loanPrincipalCents: monthlyLoanPrincipalCents,
      totalDebtServiceCents: monthlyTotalDebtServiceCents,
      remainingLoanPrincipalCents,
      profitFirstProfitPotCents,
      ownerSalaryPotCents,
      maintenancePotCents,
      marketingPotCents: marketingSpendMonthlyCents,
      fiscusReserveCents,

      // 3-Tier Hierarchy
      tier3VariableCostsCents,
      grossContributionMarginCents,
      grossContributionMarginPct,
      tier1FixedCostsCents,
      operatingCashFlowCents,
      tier2InvestmentsCents,
      netRetainedCashCents,
      alfFeesMonthlyCents,
      marketingSpendMonthlyCents,

      netFreeCashAfterPotsCents,
      profitFirstHealth,
      revenueTargetCents: target,
      revenueTargetProgressPct: targetProgressPct,
      isCurrentMonth: mKey === currentMonthKey,
    }
  })

  const totalBerthFeeCents = quarterlyBerthFeeCents * 4
  const totalFixedCostsCents = totalBerthFeeCents + (monthlyOtherFixedCostsCents * 12)
  const totalDebtServiceCents = (monthlyLoanPrincipalCents + monthlyLoanInterestCents) * 12
  const finalRemainingLoanCents = Math.max(0, initialTotalLoanPrincipalCents - totalLoanPrincipalCents)
  const monthsUntilDebtFree = monthlyLoanPrincipalCents > 0
    ? Math.ceil(initialTotalLoanPrincipalCents / monthlyLoanPrincipalCents)
    : 0

  // Multi-Loan Summaries
  let cumulativeLoanOffset = 0
  const loansSummary: LoanSummaryItem[] = activeLoans.map(loan => {
    const loanRepaidInYear = loan.monthlyPrincipalCents * 12
    const remaining = Math.max(0, loan.principalTotalCents - loanRepaidInYear)
    const months = loan.monthlyPrincipalCents > 0
      ? Math.ceil(loan.principalTotalCents / loan.monthlyPrincipalCents)
      : 0
    cumulativeLoanOffset += loan.monthlyPrincipalCents
    return {
      id: loan.id,
      name: loan.name,
      principalTotalCents: loan.principalTotalCents,
      monthlyPrincipalCents: loan.monthlyPrincipalCents,
      monthlyInterestCents: loan.monthlyInterestCents,
      interestRatePct: loan.interestRatePct,
      remainingPrincipalCents: remaining,
      monthsUntilPaidOff: months,
    }
  })

  // Scenario Simulator: Marketing (€2.000 vs €4.000 etc.)
  const baselineMarketingSpendCents = 200000 // € 2.000 baseline
  const activeMarketingSpendCents = settings.marketingScenarioSpendCents ?? 200000
  const deltaMarketingSpendCents = activeMarketingSpendCents - baselineMarketingSpendCents
  const avgMarginPerCruise = totalBookingCount > 0
    ? Math.round(totalGrossContributionMarginCents / totalBookingCount)
    : 26000 // Fallback € 260 / cruise
  const breakevenCruisesNeeded = (deltaMarketingSpendCents > 0 && avgMarginPerCruise > 0)
    ? Math.round((deltaMarketingSpendCents / avgMarginPerCruise) * 10) / 10
    : 0
  // Estimated 1 booking per € 150 ad spend in high season
  const projectedExtraBookings = deltaMarketingSpendCents > 0 ? Math.round(deltaMarketingSpendCents / 15000) : 0
  const projectedNetExtraProfitCents = (projectedExtraBookings * avgMarginPerCruise) - Math.max(0, deltaMarketingSpendCents)

  // Scenario Simulator: Amsterdam Light Festival (€1.900 per categorie)
  const activeAlfCategories = alfCategories.filter(c => c.active)
  const alfCategoryDetails = alfCategories.map(cat => ({
    id: cat.id,
    name: cat.name,
    active: cat.active,
    feeCents: cat.feeCents,
    breakevenCruises: avgMarginPerCruise > 0 ? Math.ceil(cat.feeCents / avgMarginPerCruise) : 8,
    breakevenTickets: Math.ceil(cat.feeCents / (cat.ticketPriceCents || 3500)),
  }))
  const breakevenTotalAlfCruises = avgMarginPerCruise > 0
    ? Math.ceil(totalActiveAlfFeesCents / avgMarginPerCruise)
    : 15

  // Investerings-Thermometer & Stoplicht
  const monthlyGrossMargin = totalBookingCount > 0 ? Math.round(totalGrossContributionMarginCents / 12) : 0
  const monthlyFixedNeeds = Math.round(totalTier1FixedCostsCents / 12)
  const monthlyNetCashFlow = monthlyGrossMargin - monthlyFixedNeeds
  const freeInvestmentCapacityCents = Math.max(0, monthlyNetCashFlow)

  let investmentStatus: 'green' | 'orange' | 'red' = 'green'
  let canInvest4kMarketing = true
  let canInvestAlf = true
  let recommendationText = 'Groen licht: Je dekkingsbijdrage biedt voldoende speelgeld voor zowel € 4k marketing als Amsterdam Light Festival.'

  if (freeInvestmentCapacityCents < 200000) {
    investmentStatus = 'red'
    canInvest4kMarketing = false
    canInvestAlf = false
    recommendationText = 'Stoplicht Rood: Focus nu op je vaste lasten en seizoenspotjes. Houd marketing op basis (€ 2.000) en vermijd extra verplichtingen.'
  } else if (freeInvestmentCapacityCents < 400000) {
    investmentStatus = 'orange'
    canInvest4kMarketing = false
    canInvestAlf = true
    recommendationText = 'Stoplicht Oranje: Basis marketing (€ 2.000) is veilig. Kies voor óf € 4k marketing óf ALF Categorie 1, niet beide tegelijk.'
  }

  const totals: CockpitTotals = {
    totalRevenueCents,
    totalOperatingProfitCents,
    overallProfitMarginPct: totalRevenueCents > 0 ? Math.round((totalOperatingProfitCents / totalRevenueCents) * 100) : 0,
    totalSkipperCostCents,
    overallSkipperRatioPct: totalRevenueCents > 0 ? Math.round((totalSkipperCostCents / totalRevenueCents) * 100) : 0,
    totalCateringSellingCents,
    totalCateringCostCents,
    overallCateringMarginPct: totalCateringSellingCents > 0
      ? Math.round(((totalCateringSellingCents - totalCateringCostCents) / totalCateringSellingCents) * 100)
      : 0,
    totalZettleSellingCents,
    totalFixedCostsCents,
    totalBerthFeeCents,
    totalOwnerSalaryCents,
    totalProfitFirstProfitCents,
    totalLoanInterestCents,
    totalLoanPrincipalCents,
    totalDebtServiceCents,
    remainingLoanPrincipalCents: finalRemainingLoanCents,
    monthsUntilDebtFree,
    totalMaintenanceReservedCents,
    totalMarketingBudgetCents,
    totalHoursCruised: Math.round(totalHoursCruised * 10) / 10,
    averageProfitPerHourCents: totalHoursCruised > 0 ? Math.round(totalOperatingProfitCents / totalHoursCruised) : 0,

    // 3-Tier Totals
    totalTier3VariableCostsCents,
    totalGrossContributionMarginCents,
    overallGrossContributionMarginPct: totalRevenueCents > 0 ? Math.round((totalGrossContributionMarginCents / totalRevenueCents) * 100) : 0,
    totalTier1FixedCostsCents,
    totalOperatingCashFlowCents,
    totalTier2InvestmentsCents,
    totalNetRetainedCashCents,

    // Multi-Loan Summaries
    loansSummary,

    // Scenario Simulator Outputs
    marketingScenario: {
      baselineSpendCents: baselineMarketingSpendCents,
      activeSpendCents: activeMarketingSpendCents,
      deltaSpendCents: deltaMarketingSpendCents,
      breakevenCruisesNeeded,
      projectedExtraBookings,
      projectedNetExtraProfitCents,
    },

    alfScenario: {
      totalActiveCategories: activeAlfCategories.length,
      totalFeesCents: totalActiveAlfFeesCents,
      categories: alfCategoryDetails,
      breakevenTotalCruises: breakevenTotalAlfCruises,
    },

    investmentGauge: {
      freeInvestmentCapacityCents,
      status: investmentStatus,
      canInvest4kMarketing,
      canInvestAlf,
      recommendationText,
    },
    fixedCostItems: activeFixedCostItems,
  }

  return { months, totals }
}
