import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow'
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
    .select('slug, cancellation_policy, payment_mode, required_partner_id')
    .eq('slug', slug)
    .eq('is_published', true)
    .single()

  if (!listingData) notFound()

  const listing = listingData as CruiseListing
  const cancellationPolicy =
    typeof listing.cancellation_policy === 'string'
      ? listing.cancellation_policy
      : (listing.cancellation_policy as { text?: string } | null)?.text ?? null

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
        cancellationPolicy={cancellationPolicy}
        initialCode={code}
        paymentMode={paymentMode}
        partnerName={partnerName}
      />
    </div>
  )
}
