import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { quarterFromDate, currentQuarter } from '@/lib/quarters'
import { PortalHeader } from './components/PortalHeader'
import { CampaignsSection } from './components/CampaignsSection'
import { RecentBookingsSection } from './components/RecentBookingsSection'
import { SettlementsSection } from './components/SettlementsSection'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Partner portal — Off Course Amsterdam',
  robots: { index: false, follow: false },
}

interface Props {
  params: Promise<{ token: string }>
}

export default async function PartnerPortalPage({ params }: Props) {
  const { token } = await params
  const supabase = createAdminClient()

  const { data: partner } = await supabase
    .from('partners')
    .select('id, name, report_token, is_active')
    .eq('report_token', token)
    .maybeSingle()

  if (!partner) notFound()

  const partnerId = partner.id
  const portalUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'}/partners/${token}`

  // Phase 1: campaigns (needed to filter sessions)
  const { data: campaignsList } = await supabase
    .from('campaigns')
    .select('id, name, slug, is_active')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })

  const campaigns = (campaignsList ?? []).filter(c => c.is_active !== false)
  const campaignSlugs = campaigns.map(c => c.slug)

  const since = new Date()
  since.setUTCDate(since.getUTCDate() - 30)
  const sinceIso = since.toISOString()
  const sinceDate = sinceIso.slice(0, 10)

  // Phase 2: sessions (filtered by this partner's campaign slugs) + bookings + settlements
  const [sessionsRes, recentBookingsRes, allBookingsRes, settlementsRes] = await Promise.all([
    campaignSlugs.length > 0
      ? supabase
          .from('analytics_sessions')
          .select('campaign_slug')
          .in('campaign_slug', campaignSlugs)
          .gte('started_at', sinceIso)
      : Promise.resolve({ data: [] as Array<{ campaign_slug: string | null }> }),
    supabase
      .from('bookings')
      .select('id, listing_title, booking_date, start_time, guest_count, base_amount_cents, commission_amount_cents, customer_email, booking_source, campaign_id')
      .eq('partner_id', partnerId)
      .order('booking_date', { ascending: false })
      .limit(20),
    supabase
      .from('bookings')
      .select('booking_date, base_amount_cents, commission_amount_cents, booking_source, campaign_id')
      .eq('partner_id', partnerId),
    supabase
      .from('partner_settlements')
      .select('id, quarter, settlement_type, amount_cents, paid_at')
      .eq('partner_id', partnerId),
  ])

  const sessions = sessionsRes.data ?? []
  const recentBookings = recentBookingsRes.data ?? []
  const allBookings = allBookingsRes.data ?? []
  const settlements = settlementsRes.data ?? []

  // Per-campaign 30-day metrics
  const sessionsByCampaignSlug = new Map<string, number>()
  for (const s of sessions) {
    if (s.campaign_slug) {
      sessionsByCampaignSlug.set(s.campaign_slug, (sessionsByCampaignSlug.get(s.campaign_slug) ?? 0) + 1)
    }
  }

  const recentBookingsByCampaignId = new Map<string, { count: number; revenue: number; commission: number }>()
  for (const b of allBookings) {
    if (!b.campaign_id || !b.booking_date) continue
    if (b.booking_date < sinceDate) continue
    const cur = recentBookingsByCampaignId.get(b.campaign_id) ?? { count: 0, revenue: 0, commission: 0 }
    cur.count += 1
    cur.revenue += Number(b.base_amount_cents ?? 0)
    cur.commission += Number(b.commission_amount_cents ?? 0)
    recentBookingsByCampaignId.set(b.campaign_id, cur)
  }

  const campaignCards = campaigns.map(c => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    trackingUrl: `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://offcourseamsterdam.com'}/t/${c.slug}`,
    sessions: sessionsByCampaignSlug.get(c.slug) ?? 0,
    bookings: recentBookingsByCampaignId.get(c.id)?.count ?? 0,
    revenueCents: recentBookingsByCampaignId.get(c.id)?.revenue ?? 0,
    commissionCents: recentBookingsByCampaignId.get(c.id)?.commission ?? 0,
  }))

  // Quarterly settlement totals
  type Bucket = { quarter: string; type: 'partner_invoice' | 'affiliate'; count: number; base: number; commission: number }
  const buckets: Record<string, Bucket> = {}
  for (const b of allBookings) {
    if (!b.booking_date) continue
    const quarter = quarterFromDate(b.booking_date)
    const type: 'partner_invoice' | 'affiliate' = b.booking_source === 'partner_invoice' ? 'partner_invoice' : 'affiliate'
    const key = `${quarter}::${type}`
    const bucket = buckets[key] ?? { quarter, type, count: 0, base: 0, commission: 0 }
    bucket.count += 1
    bucket.base += Number(b.base_amount_cents ?? 0)
    bucket.commission += Number(b.commission_amount_cents ?? 0)
    buckets[key] = bucket
  }

  const settlementByKey = new Map<string, { id: string; amount_cents: number; paid_at: string }>()
  for (const s of settlements) {
    settlementByKey.set(`${s.quarter}::${s.settlement_type}`, {
      id: s.id,
      amount_cents: s.amount_cents,
      paid_at: s.paid_at,
    })
  }

  const nowQuarter = currentQuarter()
  function buildSettlementRows(type: 'partner_invoice' | 'affiliate') {
    return Object.values(buckets)
      .filter(b => b.type === type)
      .map(b => {
        const key = `${b.quarter}::${type}`
        const settlement = settlementByKey.get(key)
        const netAmountCents = type === 'partner_invoice' ? b.base - b.commission : b.commission
        return {
          quarter: b.quarter,
          isCurrent: b.quarter === nowQuarter,
          bookingCount: b.count,
          baseAmountCents: b.base,
          netAmountCents,
          settled: !!settlement,
          settledAt: settlement?.paid_at ?? null,
        }
      })
      .sort((a, b) => (a.quarter > b.quarter ? -1 : 1))
  }

  const partnerInvoiceRows = buildSettlementRows('partner_invoice')
  const affiliateRows = buildSettlementRows('affiliate')

  const recentBookingItems = recentBookings.map(b => ({
    id: b.id,
    listingTitle: b.listing_title ?? 'Cruise',
    bookingDate: b.booking_date ?? null,
    startTime: b.start_time ?? null,
    guestCount: b.guest_count ?? 0,
    baseAmountCents: Number(b.base_amount_cents ?? 0),
    commissionAmountCents: Number(b.commission_amount_cents ?? 0),
    customerEmailMasked: maskEmail(b.customer_email),
    isPartnerInvoice: b.booking_source === 'partner_invoice',
  }))

  const hasData = campaignCards.length > 0 || recentBookingItems.length > 0 || partnerInvoiceRows.length > 0 || affiliateRows.length > 0

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10 space-y-8">
        <PortalHeader name={partner.name} portalUrl={portalUrl} />

        {campaignCards.length > 0 && <CampaignsSection campaigns={campaignCards} />}
        {recentBookingItems.length > 0 && <RecentBookingsSection bookings={recentBookingItems} />}
        {(partnerInvoiceRows.length > 0 || affiliateRows.length > 0) && (
          <SettlementsSection
            partnerInvoiceRows={partnerInvoiceRows}
            affiliateRows={affiliateRows}
          />
        )}

        {!hasData && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
            No bookings or campaigns yet — your data will appear here once activity starts.
          </div>
        )}

        <footer className="text-xs text-zinc-400 text-center pt-4">
          Quarters settle within 14 days of quarter end. Questions?{' '}
          <a href="mailto:finance@offcourseamsterdam.com" className="underline hover:text-zinc-700">
            finance@offcourseamsterdam.com
          </a>
        </footer>
      </div>
    </main>
  )
}

function maskEmail(email: string | null): string {
  if (!email) return ''
  const [local, domain] = email.split('@')
  if (!domain) return '***'
  const localMasked = (local[0] ?? '') + '***'
  const [domainName, ...tldParts] = domain.split('.')
  const tld = tldParts.join('.')
  const domainMasked = (domainName?.[0] ?? '') + '***' + (tld ? '.' + tld : '')
  return `${localMasked}@${domainMasked}`
}
