import { createClient } from '@/lib/supabase/server'
import { getFilteredAvailability } from '@/lib/fareharbor/availability'
import { SearchResultsPage } from '@/components/search/SearchResultsPage'
import type { SearchResult } from '@/types'

export const revalidate = 0

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ date?: string; guests?: string }>
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale } = await params
  const { date, guests: guestsStr } = await searchParams
  const guests = Number(guestsStr ?? 2)

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return <SearchResultsPage results={[]} date="" guests={guests} locale={locale} />
  }

  const supabase = await createClient()
  const { data: listings } = await supabase
    .from('cruise_listings')
    .select('*')
    .eq('is_published', true)
    .order('display_order', { ascending: true })

  const results: SearchResult[] = await Promise.all(
    (listings ?? []).map(async listing => {
      const { slots } = await getFilteredAvailability(listing.id, date, guests)
      return { listing, availableSlots: slots, date, guests }
    })
  )

  return <SearchResultsPage results={results} date={date} guests={guests} locale={locale} />
}
