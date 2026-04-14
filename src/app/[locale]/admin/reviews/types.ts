export type Review = {
  id: string
  reviewer_name: string
  review_text: string
  rating: number
  source: string
  is_active: boolean
  sort_order: number
  author_photo_url: string | null
  google_profile_url: string | null
  google_review_id: string | null
  publish_time: string | null
  language: string | null
  created_at: string
  owner_reply_text: string | null
  owner_reply_time: string | null
  reply_synced_at: string | null
  ai_draft_reply: string | null
  confirmed_reply: string | null
  reply_posted_at: string | null
}

export type GoogleConfig = {
  place_id: string
  place_name: string | null
  overall_rating: number | null
  total_reviews: number | null
  last_synced_at: string | null
  is_gbp_connected: boolean
  oauth_email: string | null
  oauth_connected_at: string | null
}
