import { SearchResultsPage } from '@/components/search/SearchResultsPage'
import { fetchSearchResults } from '@/lib/search/fetch-search-results'

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

  const results = await fetchSearchResults(date, guests)
  return <SearchResultsPage results={results} date={date} guests={guests} locale={locale} />
}
