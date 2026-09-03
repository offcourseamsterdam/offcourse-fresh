import { calculateCateringOrderCosts, resolveItemCostPrice, type ExtraCatalogItem } from './catering-costs'

export interface CockpitBudgetSettings {
  maintenancePct: number // default 8
  marketingPct: number // default 6
  profitFirstProfitPct: number // default 5 (5% van omzet direct naar winstrekening)
  ownerSalaryMonthlyCents: number // default 350000 (€ 3.500 / maand)
  ownerSalaryPct: number // default 0 (of als % van omzet)
  boatCount: number // default 2
  berthFeePerBoatYearlyCents: number // default 400000 (€ 4.000 ex BTW per boot per jaar)
  otherFixedCostsMonthlyCents: number // default 120000 (€ 1.200 / maand)
  zettleCogsPct: number // default 28 (28% inkoop op boordverkoop)
  fixedCostsMonthlyCents: number // legacy fallback
  winterBufferTargetCents: number // default 2500000 (€ 25.000)
  defaultMonthlyRevenueTargetCents: number // default 4000000 (€ 40.000)
  targetSkipperRatioPct: number // default 18
  targetCateringMarginPct: number // default 55
  defaultSkipperHourlyRateCents: number // default 3500 (€ 35/h)
}

export const DEFAULT_BUDGET_SETTINGS: CockpitBudgetSettings = {
  maintenancePct: 8.0,
  marketingPct: 6.0,
  profitFirstProfitPct: 5.0,
  ownerSalaryMonthlyCents: 350000,
  ownerSalaryPct: 0.0,
  boatCount: 2,
  berthFeePerBoatYearlyCents: 400000,
  otherFixedCostsMonthlyCents: 120000,
  zettleCogsPct: 28.0,
  fixedCostsMonthlyCents: 186667, // (2 * 4000/12) + 1200 = ~1867
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
  // Profit First toewijzingen
  profitFirstProfitPotCents: number // Directe winstreservering
  ownerSalaryPotCents: number // Eigenaarsbeloning
  maintenancePotCents: number // 8% Capex
  marketingPotCents: number // 6% Groei
  fiscusReserveCents: number // BTW + City Tax
  // Netto overblijvende vrije cash na alle potjes en vaste lasten
  netFreeCashAfterPotsCents: number
  profitFirstHealth: 'healthy' | 'tight' | 'deficit'
  // Target comparisons
  revenueTargetCents: number
  revenueTargetProgressPct: number
  isCurrentMonth: boolean
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
  totalMaintenanceReservedCents: number
  totalMarketingBudgetCents: number
  totalHoursCruised: number
  averageProfitPerHourCents: number
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

  // Monthly fixed costs:
  // Liggeld = (boatCount * berthFeePerBoatYearlyCents) / 12
  const monthlyBerthFeeCents = Math.round((settings.boatCount * settings.berthFeePerBoatYearlyCents) / 12)
  const monthlyOtherFixedCostsCents = settings.otherFixedCostsMonthlyCents
  const monthlyTotalFixedCostsCents = monthlyBerthFeeCents + monthlyOtherFixedCostsCents

  let totalRevenueCents = 0
  let totalProfitCents = 0
  let totalSkipperCostCents = 0
  let totalCateringSellingCents = 0
  let totalCateringCostCents = 0
  let totalZettleSellingCents = 0
  let totalMaintenanceReservedCents = 0
  let totalMarketingBudgetCents = 0
  let totalProfitFirstProfitCents = 0
  let totalOwnerSalaryCents = 0
  let totalHoursCruised = 0

  const months: MonthlyCockpitRow[] = monthKeys.map(mKey => {
    const monthIndex = parseInt(mKey.slice(5, 7), 10) - 1
    const monthLabel = `${DUTCH_MONTH_NAMES[monthIndex]} ${year}`
    const bList = bookingsByMonth[mKey] || []
    const sList = shiftsByMonth[mKey] || []
    const zData = zettleByMonth[mKey]

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

    // Operating Profit (voor vaste lasten)
    const operatingProfitCents = revCents - commissionCents - cityTaxCents - cateringCost - mSkipperCost
    const operatingProfitPct = revCents > 0 ? Math.round((operatingProfitCents / revCents) * 100) : 0
    const profitPerHourCents = mHours > 0 ? Math.round(operatingProfitCents / mHours) : 0
    const skipperRatioPct = revCents > 0 ? Math.round((mSkipperCost / revCents) * 100) : 0

    // ── PROFIT FIRST TOEKIEZINGEN ──
    // 1. Winstpot (direct 5-10% afromen)
    const profitFirstProfitPotCents = Math.round(revCents * (settings.profitFirstProfitPct / 100))

    // 2. Eigenaarssalaris (vast bedrag of % van omzet)
    const ownerSalaryPotCents = settings.ownerSalaryPct > 0
      ? Math.round(revCents * (settings.ownerSalaryPct / 100))
      : settings.ownerSalaryMonthlyCents

    // 3. Vloot & Onderhoud (8%)
    const maintenancePotCents = Math.round(revCents * (settings.maintenancePct / 100))

    // 4. Marketing & Groei (6%)
    const marketingPotCents = Math.round(revCents * (settings.marketingPct / 100))

    // 5. Belastingreservering (BTW + City Tax + Zettle BTW)
    const fiscusReserveCents = Math.round(cityTaxCents + (bookingRevCents * 0.09) + zettleVat)

    // 6. Netto Vrije Cash na aftrek van ALLE potjes EN vaste lasten
    const netFreeCashAfterPotsCents = operatingProfitCents 
      - monthlyTotalFixedCostsCents 
      - profitFirstProfitPotCents 
      - ownerSalaryPotCents 
      - maintenancePotCents 
      - marketingPotCents

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
    totalProfitCents += operatingProfitCents
    totalSkipperCostCents += mSkipperCost
    totalCateringSellingCents += cateringSell
    totalCateringCostCents += cateringCost
    totalZettleSellingCents += zettleSell
    totalMaintenanceReservedCents += maintenancePotCents
    totalMarketingBudgetCents += marketingPotCents
    totalProfitFirstProfitCents += profitFirstProfitPotCents
    totalOwnerSalaryCents += ownerSalaryPotCents
    totalHoursCruised += mHours

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
      berthFeeMonthlyCents: monthlyBerthFeeCents,
      otherFixedCostsMonthlyCents: monthlyOtherFixedCostsCents,
      totalFixedCostsCents: monthlyTotalFixedCostsCents,
      profitFirstProfitPotCents,
      ownerSalaryPotCents,
      maintenancePotCents,
      marketingPotCents,
      fiscusReserveCents,
      netFreeCashAfterPotsCents,
      profitFirstHealth,
      revenueTargetCents: target,
      revenueTargetProgressPct: targetProgressPct,
      isCurrentMonth: mKey === currentMonthKey,
    }
  })

  const totalFixedCostsCents = monthlyTotalFixedCostsCents * 12
  const totalBerthFeeCents = monthlyBerthFeeCents * 12

  const totals: CockpitTotals = {
    totalRevenueCents,
    totalOperatingProfitCents: totalProfitCents,
    overallProfitMarginPct: totalRevenueCents > 0 ? Math.round((totalProfitCents / totalRevenueCents) * 100) : 0,
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
    totalMaintenanceReservedCents,
    totalMarketingBudgetCents,
    totalHoursCruised: Math.round(totalHoursCruised * 10) / 10,
    averageProfitPerHourCents: totalHoursCruised > 0 ? Math.round(totalProfitCents / totalHoursCruised) : 0,
  }

  return { months, totals }
}
