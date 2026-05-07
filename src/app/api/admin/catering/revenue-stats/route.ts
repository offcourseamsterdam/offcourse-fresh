import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

interface ExtrasLineItem {
  name: string
  amount_cents: number
  category?: string
}

function sumCategory(extras: ExtrasLineItem[], category: string): number {
  return extras
    .filter(e => e.category === category)
    .reduce((sum, e) => sum + e.amount_cents, 0)
}

function pct(part: number, total: number): number {
  if (total === 0) return 0
  return Math.round((part / total) * 1000) / 10 // one decimal, e.g. 33.3
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const from = searchParams.get('from') // ISO string or YYYY-MM-DD
    const to = searchParams.get('to')

    const supabase = createAdminClient()

    let query = supabase
      .from('bookings')
      .select('extras_selected')
      .in('status', ['confirmed', 'booked'])

    if (from) query = query.gte('booking_date', from.slice(0, 10))
    if (to)   query = query.lte('booking_date', to.slice(0, 10))

    const { data, error } = await query

    if (error) return apiError(error.message)

    const bookings = data ?? []
    const totalBookings = bookings.length

    let foodRevenueCents = 0
    let drinksRevenueCents = 0
    let foodBookingCount = 0
    let cateringBookingCount = 0

    const drinksByName: Record<string, { count: number; revenueCents: number }> = {}
    let noDrinksCount = 0

    for (const booking of bookings) {
      const extras = (booking.extras_selected as ExtrasLineItem[] | null) ?? []

      const food = sumCategory(extras, 'food')
      const drinks = sumCategory(extras, 'drinks')

      foodRevenueCents += food
      drinksRevenueCents += drinks

      if (food > 0) foodBookingCount++
      if (food > 0 || drinks > 0) cateringBookingCount++

      const drinkItems = extras.filter(e => e.category === 'drinks')
      if (drinkItems.length === 0) {
        noDrinksCount++
      } else {
        for (const item of drinkItems) {
          if (!drinksByName[item.name]) drinksByName[item.name] = { count: 0, revenueCents: 0 }
          drinksByName[item.name].count++
          drinksByName[item.name].revenueCents += item.amount_cents
        }
      }
    }

    const totalRevenueCents = foodRevenueCents + drinksRevenueCents
    const avgCateringCents = cateringBookingCount > 0
      ? Math.round(totalRevenueCents / cateringBookingCount)
      : 0

    const drinksBreakdown = [
      ...Object.entries(drinksByName)
        .map(([name, d]) => ({ name, count: d.count, pct: pct(d.count, totalBookings) }))
        .sort((a, b) => b.count - a.count),
      { name: 'No drinks extra', count: noDrinksCount, pct: pct(noDrinksCount, totalBookings) },
    ]

    return apiOk({
      totalRevenueCents,
      foodRevenueCents,
      drinksRevenueCents,
      totalBookingCount: totalBookings,
      cateringBookingCount,
      avgCateringCents,
      foodPct: pct(foodBookingCount, totalBookings),
      noFoodPct: pct(totalBookings - foodBookingCount, totalBookings),
      drinksBreakdown,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
