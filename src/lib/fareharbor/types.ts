// FareHarbor External API v1 — TypeScript types
// These represent the raw API response shapes, NOT the Supabase table types.

// ── Items ───────────────────────────────────────────────────────────────────

export interface FHItem {
  pk: number
  name: string
  shortname: string
  customer_type_rates: FHCustomerTypeRate[]
  resources: FHResource[]
  image_cdn_url?: string
  description?: string
}

export interface FHResource {
  pk: number
  name: string
  capacity: number
}

export interface FHCustomerType {
  pk: number
  singular: string
  plural: string
}

export interface FHCustomerTypeRate {
  pk: number
  customer_type: FHCustomerType
  capacity: number
  total_capacity?: number
  minimum_party_size?: number
  maximum_party_size?: number
  customer_prototype?: {
    pk: number
    display_name: string
    /** NET price in cents (excl. VAT). Do NOT use this to charge customers. */
    total: number
    /** GROSS price in cents (incl. VAT). Use this for any customer-facing charge or display. */
    total_including_tax?: number
  }
}

// ── Availabilities ──────────────────────────────────────────────────────────

export interface FHMinimalAvailability {
  pk: number
  start_at: string   // ISO datetime e.g. "2026-04-05T14:00:00+02:00"
  end_at: string
  capacity: number
  customer_type_rates: FHCustomerTypeRate[]
  headline?: string
}

export interface FHAvailabilityDetail extends FHMinimalAvailability {
  resources: FHResource[]
  item: {
    pk: number
    name: string
  }
}

// ── Bookings ────────────────────────────────────────────────────────────────

export interface FHContact {
  name: string
  phone: string
  email: string
}

export interface FHBookingCustomer {
  customer_type_rate: number  // customer_type_rate PK
}

export interface FHBookingRequest {
  contact: FHContact
  customers: FHBookingCustomer[]
  note?: string
  voucher_number?: string
}

export interface FHBookingResponse {
  pk: number
  uuid: string
  availability: {
    pk: number
    start_at: string
    end_at: string
    item: { pk: number; name: string }
  }
  contact: FHContact
  customers: Array<{
    pk: number
    customer_type_rate: FHCustomerTypeRate
  }>
  status: string
  created_at: string
  rebooked_from?: string
  rebooked_to?: string
}

export interface FHValidationResult {
  is_bookable: boolean
  code?: string
  error?: string
  receipt_total?: number
  receipt_subtotal?: number
  receipt_taxes?: number
  invoice_price?: number | null
}

// ── API Response Wrappers ───────────────────────────────────────────────────

export interface FHItemsResponse {
  items: FHItem[]
}

export interface FHItemDetailResponse {
  item: FHItem
}

export interface FHAvailabilitiesResponse {
  availabilities: FHMinimalAvailability[]
}

export interface FHAvailabilityDetailResponse {
  availability: FHAvailabilityDetail
}

export interface FHBookingCreateResponse {
  booking: FHBookingResponse
}

export interface FHBookingsListResponse {
  bookings: FHBookingResponse[]
}

// ── Errors ──────────────────────────────────────────────────────────────────

export class FareHarborError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: unknown
  ) {
    super(message)
    this.name = 'FareHarborError'
  }
}

export class FHAuthError extends FareHarborError {
  constructor() {
    super('FareHarbor authentication failed — check API keys', 403)
    this.name = 'FHAuthError'
  }
}

export class FHNotFoundError extends FareHarborError {
  constructor(resource: string) {
    super(`FareHarbor resource not found: ${resource}`, 404)
    this.name = 'FHNotFoundError'
  }
}

export class FHRateLimitError extends FareHarborError {
  constructor() {
    super('FareHarbor rate limit exceeded', 429)
    this.name = 'FHRateLimitError'
  }
}

export class FHValidationError extends FareHarborError {
  public errors: string[]
  constructor(errors: string[]) {
    super(`FareHarbor validation failed: ${errors.join(', ')}`, 400)
    this.name = 'FHValidationError'
    this.errors = errors
  }
}
