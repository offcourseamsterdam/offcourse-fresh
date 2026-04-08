import type {
  FHItem,
  FHItemsResponse,
  FHItemDetailResponse,
  FHMinimalAvailability,
  FHAvailabilitiesResponse,
  FHAvailabilityDetail,
  FHAvailabilityDetailResponse,
  FHBookingRequest,
  FHBookingResponse,
  FHBookingCreateResponse,
  FHBookingsListResponse,
  FHValidationResult,
} from './types'
import {
  FareHarborError,
  FHAuthError,
  FHNotFoundError,
  FHRateLimitError,
  FHValidationError,
} from './types'

// ── Rate limiter (module-level singleton) ───────────────────────────────────

class TokenBucket {
  private tokens: number
  private lastRefill: number

  constructor(
    private maxTokens: number,
    private refillRate: number // tokens per second
  ) {
    this.tokens = maxTokens
    this.lastRefill = Date.now()
  }

  async acquire(): Promise<void> {
    this.refill()
    if (this.tokens >= 1) {
      this.tokens -= 1
      return
    }
    // Wait until a token is available
    const waitMs = ((1 - this.tokens) / this.refillRate) * 1000
    await new Promise(resolve => setTimeout(resolve, Math.ceil(waitMs)))
    this.refill()
    this.tokens -= 1
  }

  private refill() {
    const now = Date.now()
    const elapsed = (now - this.lastRefill) / 1000
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate)
    this.lastRefill = now
  }
}

const rateLimiter = new TokenBucket(30, 30)

// ── In-memory cache (60s TTL, GET requests only) ────────────────────────────

interface CacheEntry {
  data: unknown
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    cache.delete(key)
    return null
  }
  return entry.data as T
}

function setCache(key: string, data: unknown, ttlMs: number = 60_000) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs })
}

// ── Client ──────────────────────────────────────────────────────────────────

const COMPANY = 'offcourse'
const MAX_RETRIES = 3
const EXTERNAL_API_BASE = 'https://fareharbor.com/api/external/v1'

export class FareHarborClient {
  private baseUrl: string
  private appKey: string
  private userKey: string

  constructor() {
    this.baseUrl = process.env.FAREHARBOR_API_BASE || 'https://fareharbor.com/api/v1'
    this.appKey = process.env.FAREHARBOR_API_APP || ''
    this.userKey = process.env.FAREHARBOR_API_USER || ''

    if (!this.appKey || !this.userKey) {
      console.warn('FareHarbor API keys not set — client will fail on requests')
    }
  }

  // ── Public methods ──────────────────────────────────────────────────────

  async getItems(): Promise<FHItem[]> {
    const url = `/companies/${COMPANY}/items/`
    const cached = getCached<FHItem[]>(url)
    if (cached) return cached

    const res = await this.request<FHItemsResponse>(url)
    setCache(url, res.items, 300_000) // 5 min cache for items (rarely change)
    return res.items
  }

  async getItem(itemPk: number): Promise<FHItem> {
    const url = `/companies/${COMPANY}/items/${itemPk}/`
    const cached = getCached<FHItem>(url)
    if (cached) return cached

    const res = await this.request<FHItemDetailResponse>(url)
    setCache(url, res.item, 300_000)
    return res.item
  }

  async getAvailabilities(itemPk: number, date: string): Promise<FHMinimalAvailability[]> {
    const url = `/companies/${COMPANY}/items/${itemPk}/minimal/availabilities/date/${date}/`
    const cached = getCached<FHMinimalAvailability[]>(url)
    if (cached) return cached

    const res = await this.request<FHAvailabilitiesResponse>(url)
    setCache(url, res.availabilities)
    return res.availabilities
  }

  /** Fetch minimal availabilities for a date range (max 7 days per call) */
  async getAvailabilitiesDateRange(
    itemPk: number,
    startDate: string,
    endDate: string
  ): Promise<FHMinimalAvailability[]> {
    const url = `/companies/${COMPANY}/items/${itemPk}/minimal/availabilities/date-range/${startDate}/${endDate}/`
    const cached = getCached<FHMinimalAvailability[]>(url)
    if (cached) return cached

    const res = await this.request<FHAvailabilitiesResponse>(url)
    setCache(url, res.availabilities)
    return res.availabilities
  }

  /** Fetch full detail for a specific availability (after user selects a timeslot) */
  async getAvailabilityDetail(availPk: number): Promise<FHAvailabilityDetail> {
    const url = `/companies/${COMPANY}/availabilities/${availPk}/`
    const cached = getCached<FHAvailabilityDetail>(url)
    if (cached) return cached

    const res = await this.request<FHAvailabilityDetailResponse>(url)
    setCache(url, res.availability)
    return res.availability
  }

  /** Validate a booking before creating it (ALWAYS call this first) */
  async validateBooking(
    availPk: number,
    data: FHBookingRequest
  ): Promise<FHValidationResult> {
    const url = `/companies/${COMPANY}/availabilities/${availPk}/bookings/validate/`
    return this.request<FHValidationResult>(url, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  /** Create a booking (only call after successful validation + payment) */
  async createBooking(
    availPk: number,
    data: FHBookingRequest
  ): Promise<FHBookingResponse> {
    const url = `/companies/${COMPANY}/availabilities/${availPk}/bookings/`
    const res = await this.request<FHBookingCreateResponse>(url, {
      method: 'POST',
      body: JSON.stringify(data),
    })
    return res.booking
  }

  /** List bookings for a date range. Uses the external API v1 which exposes this endpoint. */
  async getBookings(minDate?: string, maxDate?: string): Promise<FHBookingResponse[]> {
    const params = new URLSearchParams()
    if (minDate) params.set('min_date', minDate)
    if (maxDate) params.set('max_date', maxDate)
    const query = params.toString()
    const path = `/companies/${COMPANY}/bookings/${query ? `?${query}` : ''}`
    const res = await this.request<FHBookingsListResponse>(path, undefined, 0, EXTERNAL_API_BASE)
    return res.bookings
  }

  /** Cancel a booking by UUID */
  async cancelBooking(bookingUuid: string): Promise<void> {
    const url = `/companies/${COMPANY}/bookings/${bookingUuid}/`
    await this.request(url, { method: 'DELETE' })
  }

  // ── Internal request handler ────────────────────────────────────────────

  private async request<T>(
    path: string,
    init?: RequestInit,
    retryCount = 0,
    baseUrlOverride?: string
  ): Promise<T> {
    await rateLimiter.acquire()

    const url = `${baseUrlOverride ?? this.baseUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        'X-FareHarbor-API-App': this.appKey,
        'X-FareHarbor-API-User': this.userKey,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })

    if (res.ok) {
      // DELETE returns no body
      if (res.status === 204 || init?.method === 'DELETE') {
        return undefined as T
      }
      return res.json() as Promise<T>
    }

    // Error handling
    if (res.status === 429 && retryCount < MAX_RETRIES) {
      const waitMs = Math.pow(2, retryCount) * 1000 // 1s, 2s, 4s
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.request<T>(path, init, retryCount + 1, baseUrlOverride)
    }

    if (res.status === 403) throw new FHAuthError()
    if (res.status === 404) throw new FHNotFoundError(path)
    if (res.status === 429) throw new FHRateLimitError()

    if (res.status === 400) {
      const body = await res.json().catch(() => ({}))
      const errors = Array.isArray(body?.errors)
        ? body.errors
        : [body?.error || 'Validation failed']
      throw new FHValidationError(errors)
    }

    const body = await res.text().catch(() => '')
    throw new FareHarborError(
      `FareHarbor API error: ${res.status} ${res.statusText}`,
      res.status,
      body
    )
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let instance: FareHarborClient | null = null

export function getFareHarborClient(): FareHarborClient {
  if (!instance) {
    instance = new FareHarborClient()
  }
  return instance
}
