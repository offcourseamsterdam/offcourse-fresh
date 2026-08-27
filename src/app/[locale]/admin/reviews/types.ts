export type Review = {
  id: string
  reviewer_name: string
  review_text: string | null
  rating: number
  source: string
  is_active: boolean
  sort_order: number
  author_photo_url: string | null
  google_profile_url: string | null
  external_review_id: string | null
  review_image_url: string | null
  publish_time: string | null
  original_text: string | null
  language: string | null
  created_at: string
}

export type ReviewsConfig = {
  place_id: string
  place_name: string | null
  overall_rating: number | null
  total_reviews: number | null
  last_synced_at: string | null
  tripadvisor_url: string | null
  tripadvisor_rating: number | null
  tripadvisor_total_reviews: number | null
  withlocals_experience_short_id: string | null
  recommendations_map_url: string | null
  tripadvisor_review_url_shared: string | null
  tripadvisor_review_url_private: string | null
  review_sms_template: string | null
  review_sms_auto_send: boolean
  review_sms_enabled: boolean
}
