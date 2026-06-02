import type { CampaignRow, PerformanceRow } from './reporting'
import type { LinkedCampaign } from './listings'

// DEV-ONLY sample data so the dashboard's visuals can be reviewed before any real
// campaign exists. Served ONLY when NODE_ENV !== 'production' AND ?demo=1 — never
// in production (see the GET route guard). These are raw inputs that flow through
// the real buildDashboardPayload pipeline, so the demo exercises real merge logic.

export const DEMO_CAMPAIGNS: CampaignRow[] = [
  { id: '1001', name: 'Private Canal Cruise — Search', status: 'ENABLED', channelType: 'SEARCH', dailyBudgetEuros: 30 },
  { id: '1002', name: 'Sunset Shared Cruise', status: 'ENABLED', channelType: 'SEARCH', dailyBudgetEuros: 20 },
  { id: '1003', name: 'Brand — Off Course', status: 'ENABLED', channelType: 'SEARCH', dailyBudgetEuros: 10 },
  { id: '1004', name: 'Light Festival (winter)', status: 'PAUSED', channelType: 'SEARCH', dailyBudgetEuros: 15 },
]

export const DEMO_PERFORMANCE: PerformanceRow[] = [
  // Healthy, profitable private cruise: 9 bookings × ~€151 net = €1362, spent €240.
  { id: '1001', name: 'Private Canal Cruise — Search', impressions: 8200, clicks: 410, ctr: 5.0, costEuros: 240, conversions: 9, conversionValueEuros: 1362, avgCpcEuros: 0.59, costPerConversionEuros: 26.7, roas: 5.68 },
  // Burning: spending with zero bookings → red verdict + guardrail would fire.
  { id: '1002', name: 'Sunset Shared Cruise', impressions: 3100, clicks: 95, ctr: 3.06, costEuros: 64, conversions: 0, conversionValueEuros: 0, avgCpcEuros: 0.67, costPerConversionEuros: null, roas: null },
  // Small but profitable brand campaign.
  { id: '1003', name: 'Brand — Off Course', impressions: 1500, clicks: 120, ctr: 8.0, costEuros: 35, conversions: 3, conversionValueEuros: 454, avgCpcEuros: 0.29, costPerConversionEuros: 11.7, roas: 12.97 },
  // 1004 is paused → no performance row (zeros via merge).
]

// Each Google Ads campaign is connected to a MARKETING campaign; the listing is
// derived from that campaign.
export const DEMO_LINK_MAP: Record<string, LinkedCampaign> = {
  '1001': {
    id: 'demo-camp-1',
    name: 'first private cruise campaign',
    slug: 'first-private-cruise-campaign',
    listing: { id: 'demo-uuid-1', slug: 'off-beaten-path-hidden-gems-canal-cruise', title: 'Private Hidden Gems Cruise' },
  },
  '1003': {
    id: 'demo-camp-2',
    name: 'brand search campaign',
    slug: 'brand-search-campaign',
    listing: { id: 'demo-uuid-2', slug: 'amsterdam-hidden-gems-canal-cruise-small-group', title: 'Off The Beaten Path Hidden Gems Canal Cruise' },
  },
}

export const DEMO_MARKETING_CAMPAIGNS: LinkedCampaign[] = [
  {
    id: 'demo-camp-1',
    name: 'first private cruise campaign',
    slug: 'first-private-cruise-campaign',
    listing: { id: 'demo-uuid-1', slug: 'off-beaten-path-hidden-gems-canal-cruise', title: 'Private Hidden Gems Cruise' },
  },
  {
    id: 'demo-camp-2',
    name: 'brand search campaign',
    slug: 'brand-search-campaign',
    listing: { id: 'demo-uuid-2', slug: 'amsterdam-hidden-gems-canal-cruise-small-group', title: 'Off The Beaten Path Hidden Gems Canal Cruise' },
  },
  {
    id: 'demo-camp-3',
    name: 'shared cruise instagram',
    slug: 'shared-cruise-instagram',
    listing: null,
  },
]
