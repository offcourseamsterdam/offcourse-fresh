/**
 * Google Business Profile API client for replying to reviews.
 *
 * This API is separate from the Places API and requires OAuth 2.0.
 * Used for: discovering account/location IDs, posting replies,
 * and fetching existing replies.
 */

const ACCOUNT_MGMT_API = 'https://mybusinessaccountmanagement.googleapis.com/v1'
const BUSINESS_INFO_API = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const MY_BUSINESS_API = 'https://mybusiness.googleapis.com/v4'

// ── Account & Location Discovery ────────────────────────────────────────────

interface GbpAccount {
  name: string       // e.g. "accounts/123456789"
  accountName: string
  type: string
  role: string
}

interface GbpLocation {
  name: string       // e.g. "locations/987654321"
  title: string
  storefrontAddress?: { locality?: string }
}

/**
 * List all Business Profile accounts the authorized user has access to.
 */
export async function listAccounts(accessToken: string): Promise<GbpAccount[]> {
  const res = await fetch(`${ACCOUNT_MGMT_API}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`List accounts failed (${res.status}): ${body}`)
  }

  const data = await res.json() as { accounts?: GbpAccount[] }
  return data.accounts ?? []
}

/**
 * List all locations for a given account.
 * The accountId should include the "accounts/" prefix.
 */
export async function listLocations(
  accessToken: string,
  accountId: string,
): Promise<GbpLocation[]> {
  // Use readMask to get name and title
  const url = `${BUSINESS_INFO_API}/${accountId}/locations?readMask=name,title,storefrontAddress`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`List locations failed (${res.status}): ${body}`)
  }

  const data = await res.json() as { locations?: GbpLocation[] }
  return data.locations ?? []
}

// ── Review Replies ──────────────────────────────────────────────────────────

interface ReviewReply {
  comment: string
  updateTime: string
}

interface GbpReview {
  name: string
  reviewId: string
  reviewer: { displayName: string }
  starRating: string
  comment: string
  createTime: string
  updateTime: string
  reviewReply?: ReviewReply
}

/**
 * Reply to a review (or update an existing reply).
 *
 * @param reviewId — the review ID suffix (extracted from the Places API resource name)
 */
export async function replyToReview(
  accessToken: string,
  accountId: string,
  locationId: string,
  reviewId: string,
  comment: string,
): Promise<ReviewReply> {
  const url = `${MY_BUSINESS_API}/${accountId}/${locationId}/reviews/${reviewId}/reply`

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Reply failed (${res.status}): ${body}`)
  }

  return res.json() as Promise<ReviewReply>
}

/**
 * Delete a reply from a review.
 */
export async function deleteReply(
  accessToken: string,
  accountId: string,
  locationId: string,
  reviewId: string,
): Promise<void> {
  const url = `${MY_BUSINESS_API}/${accountId}/${locationId}/reviews/${reviewId}/reply`

  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Delete reply failed (${res.status}): ${body}`)
  }
}

/**
 * Get a single review (including its reply if one exists).
 */
export async function getReview(
  accessToken: string,
  accountId: string,
  locationId: string,
  reviewId: string,
): Promise<GbpReview> {
  const url = `${MY_BUSINESS_API}/${accountId}/${locationId}/reviews/${reviewId}`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Get review failed (${res.status}): ${body}`)
  }

  return res.json() as Promise<GbpReview>
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the review ID suffix from a Places API resource name.
 *
 * The Places API stores `name` as "places/ChIJ.../reviews/ChdDSU..."
 * The Business Profile API needs just the "ChdDSU..." part — the review
 * ID is globally unique across both APIs.
 *
 * Returns null if the format is unexpected.
 */
export function extractReviewId(googleReviewId: string): string | null {
  if (!googleReviewId) return null
  const match = googleReviewId.match(/^places\/[^/]+\/reviews\/(.+)$/)
  return match ? match[1] : null
}
