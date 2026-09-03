import { calculateCateringOrderCosts, resolveItemCostPrice, type ExtraCatalogItem } from './catering-costs'

export interface CockpitBudgetSettings {
  maintenancePct: number // default 8
  marketingPct: number // default 6
  fixedCostsMonthlyCents: number // default 200000 (€ 2.000)
  winterBufferTargetCents: number // default 2500000 (€ 25.000)
  defaultMonthlyRevenueTargetCents: number // default 4000000 (€ 40.000)
  targetSkipperRatioPct: number // default 18
  targetCateringMarginPct: number // default 55
  defaultSkipperHourlyRateCents: number // default 3500 (€ 35/h)
}

export const DEFAULT_BUDGET_SETTINGS: CockpitBudgetSettings = {
  maintenancePct: 8.0,
  marketingPct: 6.0,
  fixedCostsMonthlyCents: 200000,
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

export interface MonthlyCockpitRow {
  month: string // '2026-08'
  monthLabel: string // 'Aug 2026'
  bookingCount: number
  totalRevenueCents: number
  channelCommissionCents: number
  cityTaxCents: number
  cateringSellingCents: number
  cateringCostCents: number
  cateringMarginCents: number
  cateringMarginPct: number
  skipperCostCents: number
  skipperHours: number
  skipperRatioPct: number
  operatingProfitCents: number
  operatingProfitPct: number
  profitPerHourCents: number
  // Dynamic pots (move with monthly revenue)
  maintenancePotCents: number
  marketingPotCents: number
  fiscusReserveCents: number
  netFreeCashAfterPotsCents: number
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
  catalog,
  settings = DEFAULT_BUDGET_SETTINGS,
  currentDate = new Date(),
}: {
  year: number
  bookings: BookingForCockpit[]
  shifts: ShiftForCockpit[]
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

  let totalRevenueCents = 0
  let totalProfitCents = 0
  let totalSkipperCostCents = 0
  let totalCateringSellingCents = 0
  let totalCateringCostCents = 0
  let totalMaintenanceReservedCents = 0
  let totalMarketingBudgetCents = 0
  let totalHoursCruised = 0

  const months: MonthlyCockpitRow[] = monthKeys.map(mKey => {
    const monthIndex = parseInt(mKey.slice(5, 7), 10) - 1
    const monthLabel = `${DUTCH_MONTH_NAMES[monthIndex]} ${year}`
    const bList = bookingsByMonth[mKey] || []
    const sList = shiftsByMonth[mKey] || []

    let revCents = 0
    let commissionCents = 0
    let guestCount = 0
    let cateringSell = 0
    let cateringCost = 0

    for (const b of bList) {
      // Revenue calculation: prefer stripe_amount or sum of base + extras
      const bookingRev = typeof b.stripe_amount === 'number' && b.stripe_amount > 0
        ? b.stripe_amount
        : (b.base_amount_cents || 0) + (b.extras_amount_cents || 0)
      revCents += bookingRev

      commissionCents += b.commission_amount_cents || 0
      guestCount += b.guest_count || 0

      // Catering
      const catRes = calculateCateringOrderCosts(
        b.extras_selected as Array<{ name: string; amount_cents: number; quantity?: number; category?: string }>,
        catalog
      )
      cateringSell += catRes.sellingCents
      cateringCost += catRes.costCents
    }

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

    // Operating Profit
    const operatingProfitCents = revCents - commissionCents - cityTaxCents - cateringCost - mSkipperCost
    const operatingProfitPct = revCents > 0 ? Math.round((operatingProfitCents / revCents) * 100) : 0
    const profitPerHourCents = mHours > 0 ? Math.round(operatingProfitCents / mHours) : 0

    const cateringMarginCents = Math.max(0, cateringSell - cateringCost)
    const cateringMarginPct = cateringSell > 0 ? Math.round((cateringMarginCents / cateringSell) * 100) : 0
    const skipperRatioPct = revCents > 0 ? Math.round((mSkipperCost / revCents) * 100) : 0

    // Dynamic Pots
    const maintenancePotCents = Math.round(revCents * (settings.maintenancePct / 100))
    const marketingPotCents = Math.round(revCents * (settings.marketingPct / 100))
    const fiscusReserveCents = Math.round(cityTaxCents + (revCents * 0.09)) // 9% average BTW + City Tax
    const netFreeCashAfterPotsCents = operatingProfitCents - maintenancePotCents - marketingPotCents

    // Revenue target
    const target = settings.defaultMonthlyRevenueTargetCents
    const targetProgressPct = target > 0 ? Math.min(100, Math.round((revCents / target) * 100)) : 0

    // Accumulate totals
    totalRevenueCents += revCents
    totalProfitCents += operatingProfitCents
    totalSkipperCostCents += mSkipperCost
    totalCateringSellingCents += cateringSell
    totalCateringCostCents += cateringCost
    totalMaintenanceReservedCents += maintenancePotCents
    totalMarketingBudgetCents += marketingPotCents
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
      skipperCostCents: mSkipperCost,
      skipperHours: Math.round(mHours * 10) / 10,
      skipperRatioPct,
      operatingProfitCents,
      operatingProfitPct,
      profitPerHourCents,
      maintenancePotCents,
      marketingPotCents,
      fiscusReserveCents,
      netFreeCashAfterPotsCents,
      revenueTargetCents: target,
      revenueTargetProgressPct: targetProgressPct,
      isCurrentMonth: mKey === currentMonthKey,
    }
  })

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
    totalMaintenanceReservedCents,
    totalMarketingBudgetCents,
    totalHoursCruised: Math.round(totalHoursCruised * 10) / 10,
    averageProfitPerHourCents: totalHoursCruised > 0 ? Math.round(totalProfitCents / totalHoursCruised) : 0,
  }

  return { months, totals }
}
