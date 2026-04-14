/**
 * Google Places API (New) client for fetching business reviews.
 *
 * Uses the Place Details endpoint to retrieve up to 5 "most relevant" reviews
 * for a given Place ID. Google returns a maximum of 5 reviews per request —
 * this is a hard API limit, not something we can paginate around.
 *
 * Requires: GOOGLE_PLACES_API_KEY environment variable.
 */

const PLACES_API_BASE = 'https://places.googleapis.com/v1'

// Fields we request — reviews are billed at the "Preferred" SKU ($0.04/req)
const REVIEW_FIELDS = [
  'reviews',
  'rating',
  'userRatingCount',
  'displayName',
].join(',')

export interface GoogleReview {
  name: string                 // internal resource name
  relativePublishTimeDescription: string
  rating: number
  text: {
    text: string
    languageCode: string
  }
  originalText?: {
    text: string
    languageCode: string
  }
  authorAttribution: {
    displayName: string
    uri: string
    photoUri: string
  }
  publishTime: string          // ISO 8601
}

export interface PlaceDetailsResponse {
  displayName?: { text: string; languageCode: string }
  rating?: number
  userRatingCount?: number
  reviews?: GoogleReview[]
}

/**
 * Fetch reviews for a Google Place by its Place ID.
 * Returns the raw Google API response with reviews, overall rating, and review count.
 */
export async function fetchGoogleReviews(placeId: string): Promise<PlaceDetailsResponse> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY environment variable is not set')
  }

  const url = `${PLACES_API_BASE}/places/${placeId}`

  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': REVIEW_FIELDS,
    },
    // Don't cache — admin triggers this manually
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Places API error (${res.status}): ${body}`)
  }

  return res.json() as Promise<PlaceDetailsResponse>
}

/**
 * Search for a place by text query and return its Place ID.
 * Useful for initial setup when the admin doesn't know the Place ID.
 */
export async function searchPlace(query: string): Promise<{ placeId: string; name: string } | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY environment variable is not set')
  }

  const res = await fetch(`${PLACES_API_BASE}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName',
    },
    body: JSON.stringify({ textQuery: query }),
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google Places search error (${res.status}): ${body}`)
  }

  const data = await res.json() as { places?: Array<{ id: string; displayName: { text: string } }> }
  const first = data.places?.[0]
  if (!first) return null

  return { placeId: first.id, name: first.displayName.text }
}
