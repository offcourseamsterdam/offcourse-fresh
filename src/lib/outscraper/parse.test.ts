import { describe, it, expect } from 'vitest'
import { parseOutscraperPayload } from './parse'

// ── Google fixtures ────────────────────────────────────────────────────────────

const GOOGLE_PAYLOAD = {
  id: 'req-123',
  status: 'Success',
  data: [
    {
      name: 'Off Course Amsterdam',
      rating: 4.9,
      reviews: 183,
      reviews_data: [
        {
          // reviews_id is the place-level id (SAME on every review) — must NOT be used.
          reviews_id: '2607333240279960583',
          review_id: 'Ci9-unique-review-id-AAA', // the real per-review unique id
          author_title: 'Mohamed Alkhouri',
          author_image: 'https://lh3.googleusercontent.com/avatar',
          author_link: 'https://www.google.com/maps/contrib/104170839246363926920',
          review_text: 'Amazing canal cruise!',
          review_rating: 5,
          review_datetime_utc: '03/17/2021 17:08:18',
          review_img_urls: ['https://lh5.googleusercontent.com/photo'],
          owner_answer: null,
        },
        {
          reviews_id: '2607333240279960583', // same place-level id
          review_id: 'Ci9-unique-review-id-BBB', // different per-review id
          author_title: 'Dong Kyu Kim',
          author_image: null,
          author_link: null,
          review_text: 'Great views!',
          review_rating: 4,
          review_datetime_utc: '01/20/2021 14:25:18',
          review_img_urls: [],
          owner_answer: null,
        },
      ],
    },
  ],
}

// ── TripAdvisor fixtures ───────────────────────────────────────────────────────

// Real TA shape: data is NESTED — data[0] is the array of reviews.
const TA_PAYLOAD = {
  id: 'req-456',
  status: 'Success',
  data: [
    [
      {
        review_link: 'https://www.tripadvisor.com/ShowUserReviews-g188590-d33274622-r945962867-Off_Course-Amsterdam.html',
        review_date: '2024-04-09',
        author_title: 'BertysMum',
        author_image: 'https://dynamic-media-cdn.tripadvisor.com/avatar.jpg',
        review_rating: 5,
        review_title: 'Fantastic boat trip',
        review_text: 'We found Off Course on the last day of our trip.',
        review_media: ['https://media.tripadvisor.com/photo.jpg'],
        reviews: 48, // place-level total
        owner_response: null,
      },
      {
        review_link: 'https://www.tripadvisor.com/ShowUserReviews-g188590-d33274622-r934711578-Off_Course-Amsterdam.html',
        review_date: '2024-01-19',
        author_title: '430brankac',
        author_image: null,
        review_rating: 4,
        review_title: 'Great experience',
        review_text: 'Lovely Amsterdam canals.',
        review_media: null,
        reviews: 48,
        owner_response: null,
      },
    ],
  ],
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('parseOutscraperPayload — Google', () => {
  it('maps reviews_data to ReviewRow shape', () => {
    const { reviews, placeMeta } = parseOutscraperPayload(GOOGLE_PAYLOAD, 'google')
    expect(reviews).toHaveLength(2)

    const r = reviews[0]!
    expect(r.external_review_id).toBe('Ci9-unique-review-id-AAA') // review_id, NOT reviews_id
    expect(reviews[1]!.external_review_id).toBe('Ci9-unique-review-id-BBB') // distinct per review
    expect(r.source).toBe('google')
    expect(r.reviewer_name).toBe('Mohamed Alkhouri')
    expect(r.rating).toBe(5)
    expect(r.review_text).toBe('Amazing canal cruise!')
    expect(r.author_photo_url).toBe('https://lh3.googleusercontent.com/avatar')
    expect(r.review_image_url).toBe('https://lh5.googleusercontent.com/photo')
    expect(r.publish_time).toBe('2021-03-17T17:08:18.000Z')
    expect(r.is_active).toBe(true)
  })

  it('returns null review_image_url when img array is empty', () => {
    const { reviews } = parseOutscraperPayload(GOOGLE_PAYLOAD, 'google')
    expect(reviews[1]!.review_image_url).toBeNull()
  })

  it('extracts place-level rating and total', () => {
    const { placeMeta } = parseOutscraperPayload(GOOGLE_PAYLOAD, 'google')
    expect(placeMeta.overall_rating).toBe(4.9)
    expect(placeMeta.total_reviews).toBe(183)
  })

  it('returns empty reviews for empty data', () => {
    const { reviews } = parseOutscraperPayload({ id: 'x', status: 'Success', data: [] }, 'google')
    expect(reviews).toHaveLength(0)
  })
})

describe('parseOutscraperPayload — TripAdvisor', () => {
  it('maps TA review objects to ReviewRow shape', () => {
    const { reviews } = parseOutscraperPayload(TA_PAYLOAD, 'tripadvisor')
    expect(reviews).toHaveLength(2)

    const r = reviews[0]!
    expect(r.external_review_id).toBe('945962867') // extracted from review_link URL
    expect(r.source).toBe('tripadvisor')
    expect(r.reviewer_name).toBe('BertysMum')
    expect(r.rating).toBe(5)
    expect(r.review_text).toBe('We found Off Course on the last day of our trip.')
    expect(r.original_text).toBe('Fantastic boat trip') // review_title
    expect(r.review_image_url).toBe('https://media.tripadvisor.com/photo.jpg')
    expect(r.publish_time).toBe('2024-04-09T00:00:00.000Z')
    expect(r.author_photo_url).toBe('https://dynamic-media-cdn.tripadvisor.com/avatar.jpg')
  })

  it('returns null review_image_url when review_media is null', () => {
    const { reviews } = parseOutscraperPayload(TA_PAYLOAD, 'tripadvisor')
    expect(reviews[1]!.review_image_url).toBeNull()
  })

  it('computes average rating from rows and reads place-level total', () => {
    const { placeMeta } = parseOutscraperPayload(TA_PAYLOAD, 'tripadvisor')
    expect(placeMeta.overall_rating).toBe(4.5) // (5 + 4) / 2
    expect(placeMeta.total_reviews).toBe(48) // from place-level `reviews` field
  })

  it('returns empty reviews for empty data', () => {
    const { reviews } = parseOutscraperPayload({ id: 'x', status: 'Success', data: [] }, 'tripadvisor')
    expect(reviews).toHaveLength(0)
  })
})
