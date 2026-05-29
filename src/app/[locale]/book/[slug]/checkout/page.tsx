import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow'
import { normalizeTiers } from '@/lib/cancellation/policy'
import type { Database } from '@/lib/supabase/types'

type CruiseListing = Database['public']['Tables']['cruise_listings']['Row']

interface Props {
  params: Promise<{ locale: string; slug: string }>
  searchParams: Promise<{ code?: string }>
}

export const metadata = {
  title: 'Checkout — Off Course Amsterdam',
  robots: { index: false, follow: false },
}

export default async function CheckoutPage({ params, searchParams }: Props) {
  const { slug } = await params
  const { code } = await searchParams
  const supabase = await createClient()

  const { data: listingData } = await supabase
    .from('cruise_listings')
    .select('slug, fareharbor_item_pk, payment_mode, required_partner_id')
    .eq('slug', slug)
    .eq('is_published', true)
    .single()

  if (!listingData) notFound()

  const listing = listingData as CruiseListing

  // Cancellation policy is owned by the parent FH item — falls back to DEFAULT_TIERS when null.
  // Admin client matches the convention used everywhere else for fareharbor_items reads.
  const { data: fhItem } = await createAdminClient()
    .from('fareharbor_items')
    .select('cancellation_tiers')
    .eq('fareharbor_pk', listing.fareharbor_item_pk)
    .maybeSingle()
  const cancellationTiers = normalizeTiers(fhItem?.cancellation_tiers)

  const paymentMode = (listing.payment_mode ?? 'stripe') as 'stripe' | 'partner_invoice'

  let partnerName: string | null = null
  if (paymentMode === 'partner_invoice' && listing.required_partner_id) {
    const { data: partner } = await supabase
      .from('partners')
      .select('name')
      .eq('id', listing.required_partner_id)
      .single()
    partnerName = partner?.name ?? null
  }

  return (
    <div className="min-h-screen bg-texture-teal">
      <CheckoutFlow
        listingSlug={slug}
        cancellationTiers={cancellationTiers}
        initialCode={code}
        paymentMode={paymentMode}
        partnerName={partnerName}
      />
    </div>
  )
}
