import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createServiceClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth/server'
import { getValidAccessToken } from '@/lib/google-reviews/oauth'
import { replyToReview, deleteReply, extractReviewId } from '@/lib/google-reviews/business-profile'

interface Ctx {
  params: Promise<{ id: string }>
}

/**
 * PUT /api/admin/reviews/:id/reply
 *
 * Send or update a reply to a Google review.
 * Body: { reply_text: string }
 */
export async function PUT(request: NextRequest, ctx: Ctx) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const { id } = await ctx.params
  const body = await request.json()
  const replyText = body.reply_text?.trim()

  if (!replyText) {
    return apiError('Reply text is required', 400)
  }

  if (replyText.length > 4096) {
    return apiError('Reply text exceeds 4096 character limit', 400)
  }

  const supabase = await createServiceClient()

  // Look up the review
  const { data: review } = await supabase
    .from('social_proof_reviews')
    .select('id, google_review_id, source')
    .eq('id', id)
    .single()

  if (!review) {
    return apiError('Review not found', 404)
  }

  if (review.source !== 'google' || !review.google_review_id) {
    return apiError('Can only reply to Google reviews', 400)
  }

  // Extract the review ID suffix from the Places API resource name
  const reviewId = extractReviewId(review.google_review_id)
  if (!reviewId) {
    return apiError('Could not extract review ID — unexpected format', 400)
  }

  // Get a valid OAuth access token (auto-refreshes if expired)
  let accessToken: string
  let accountId: string
  let locationId: string

  try {
    const auth = await getValidAccessToken()
    accessToken = auth.accessToken
    accountId = auth.accountId
    locationId = auth.locationId
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message === 'NOT_CONNECTED') {
      return apiError('Google Business Profile not connected. Please connect first.', 400)
    }
    if (message === 'REAUTH_REQUIRED') {
      return apiError('Google authorization expired. Please reconnect your Google Business Profile.', 401)
    }
    return apiError('Failed to get Google access token', 500)
  }

  // Post the reply to Google
  try {
    await replyToReview(accessToken, accountId, locationId, reviewId, replyText)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return apiError(`Failed to post reply to Google: ${message}`, 502)
  }

  // Save the reply locally
  const now = new Date().toISOString()
  await supabase
    .from('social_proof_reviews')
    .update({
      owner_reply_text: replyText,
      owner_reply_time: now,
      reply_synced_at: now,
    })
    .eq('id', id)

  return apiOk({ reply_text: replyText, reply_time: now })
}

/**
 * DELETE /api/admin/reviews/:id/reply
 *
 * Remove a reply from a Google review.
 */
export async function DELETE(_request: NextRequest, ctx: Ctx) {
  try {
    await requireRole(['admin'])
  } catch {
    return apiError('Unauthorized', 403)
  }

  const { id } = await ctx.params
  const supabase = await createServiceClient()

  // Look up the review
  const { data: review } = await supabase
    .from('social_proof_reviews')
    .select('id, google_review_id, source')
    .eq('id', id)
    .single()

  if (!review) {
    return apiError('Review not found', 404)
  }

  if (review.source !== 'google' || !review.google_review_id) {
    return apiError('Can only manage replies on Google reviews', 400)
  }

  const reviewId = extractReviewId(review.google_review_id)
  if (!reviewId) {
    return apiError('Could not extract review ID', 400)
  }

  let accessToken: string
  let accountId: string
  let locationId: string

  try {
    const auth = await getValidAccessToken()
    accessToken = auth.accessToken
    accountId = auth.accountId
    locationId = auth.locationId
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message === 'NOT_CONNECTED') {
      return apiError('Google Business Profile not connected.', 400)
    }
    if (message === 'REAUTH_REQUIRED') {
      return apiError('Google authorization expired. Please reconnect.', 401)
    }
    return apiError('Failed to get Google access token', 500)
  }

  try {
    await deleteReply(accessToken, accountId, locationId, reviewId)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return apiError(`Failed to delete reply from Google: ${message}`, 502)
  }

  // Clear the reply locally
  await supabase
    .from('social_proof_reviews')
    .update({
      owner_reply_text: null,
      owner_reply_time: null,
      reply_synced_at: null,
    })
    .eq('id', id)

  return apiOk({ deleted: true })
}
