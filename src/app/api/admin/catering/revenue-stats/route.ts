import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

interface ExtrasLineItem {
  amount_cents: number
  category?: string
}

function sumCategory(extras: ExtrasLineItem[], category: string): number {
  return extras
    .filter(e => e.category === category)
    .reduce((sum, e) => sum + e.amount_cents, 0)
}

export async function GET() {
  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('bookings')
      .select('extras_selected')
      .in('status', ['confirmed', 'booked'])

    if (error) return apiError(error.message)

    let foodRevenueCents = 0
    let foodBookingCount = 0
    let drinksRevenueCents = 0
    let drinksBookingCount = 0

    for (const booking of data ?? []) {
      const extras = (booking.extras_selected as ExtrasLineItem[] | null) ?? []
      const food = sumCategory(extras, 'food')
      const drinks = sumCategory(extras, 'drinks')
      if (food > 0) { foodRevenueCents += food; foodBookingCount++ }
      if (drinks > 0) { drinksRevenueCents += drinks; drinksBookingCount++ }
    }

    return apiOk({
      food: { revenueCents: foodRevenueCents, bookingCount: foodBookingCount },
      drinks: { revenueCents: drinksRevenueCents, bookingCount: drinksBookingCount },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return apiError(message)
  }
}
