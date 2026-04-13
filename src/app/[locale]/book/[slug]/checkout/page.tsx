import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CheckoutFlow } from '@/components/checkout/CheckoutFlow'
import type { Database } from '@/lib/supabase/types'

type CruiseListing = Database['public']['Tables']['cruise_listings']['Row']

interface Props {
  params: Promise<{ locale: string; slug: string }>
}

export const metadata = {
  title: 'Checkout — Off Course Amsterdam',
}

export default async function CheckoutPage({ params }: Props) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: listingData } = await supabase
    .from('cruise_listings')
    .select('slug, cancellation_policy')
    .eq('slug', slug)
    .eq('is_published', true)
    .single()

  if (!listingData) notFound()

  const listing = listingData as CruiseListing
  const cancellationPolicy =
    typeof listing.cancellation_policy === 'string'
      ? listing.cancellation_policy
      : (listing.cancellation_policy as { text?: string } | null)?.text ?? null

  return (
    <div className="min-h-screen bg-texture-teal">
      <CheckoutFlow
        listingSlug={slug}
        cancellationPolicy={cancellationPolicy}
      />
    </div>
  )
}
