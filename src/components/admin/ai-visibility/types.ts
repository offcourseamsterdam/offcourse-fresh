import type { AiReferralRow } from '@/lib/tracking/ai-referrers'

export interface RecentAvailabilitySession {
  id: string
  engine: string
  entry_page: string
  started_at: string | null
  booked: boolean
  revenueEuros: number
}

export interface AiReferralsData {
  engines: AiReferralRow[]
  totalSessions: number
  totalBookings: number
  totalRevenueEuros: number
  totalAvailabilitySessions: number
  totalAvailabilityBookings: number
  totalAvailabilityRevenueEuros: number
  recentAvailabilitySessions?: RecentAvailabilitySession[]
  demo?: boolean
}

export interface SnapshotSummary {
  listing_id: string
  fareharbor_item_pk: number
  category: 'private' | 'shared'
  next_available_slot: string | null
  snapshot_at: string
  raw_availability_window_days: number
}

export interface AvailabilitySyncStatus {
  count: number
  latestSnapshotAt: string | null
  snapshots: SnapshotSummary[]
}
