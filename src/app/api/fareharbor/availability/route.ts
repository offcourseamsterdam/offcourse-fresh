import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { getFilteredAvailability } from '@/lib/fareharbor/availability'

// GET /api/fareharbor/availability?listing_id={uuid}&date={YYYY-MM-DD}&guests={n}
// Returns filtered availability slots for a single cruise listing.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const listingId = searchParams.get('listing_id')
  const date = searchParams.get('date')
  const guests = Number(searchParams.get('guests') ?? 2)

  // Validate params
  if (!listingId) {
    return apiError('Missing listing_id', 400)
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return apiError('Invalid date format (use YYYY-MM-DD)', 400)
  }

  // Check for past date
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const requestedDate = new Date(date + 'T00:00:00')
  if (requestedDate < today) {
    return apiOk({
      slots: [],
      reasonCode: 'PAST_DATE',
      error: 'Cannot fetch availability for past dates',
    })
  }

  if (guests < 1 || guests > 50 || !Number.isInteger(guests)) {
    return apiError('Invalid guest count', 400)
  }

  try {
    const result = await getFilteredAvailability(listingId, date, guests)

    return apiOk({
      slots: result.slots,
      reasonCode: result.reasonCode,
      listing_id: listingId,
      date,
      guests,
    })
  } catch (error) {
    console.error('Availability API error:', error)
    return apiError('Failed to fetch availability')
  }
}
