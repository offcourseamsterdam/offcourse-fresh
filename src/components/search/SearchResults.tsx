'use client'

import { useTranslations } from 'next-intl'
import { useLocale } from 'next-intl'
import { SearchResultCard } from './SearchResultCard'
import type { SearchResult } from '@/types'
import type { Locale } from '@/lib/i18n/config'
import { formatDate } from '@/lib/utils'

interface SearchResultsProps {
  results: SearchResult[]
  date: string
  guests: number
  loading: boolean
}

export function SearchResults({ results, date, guests, loading }: SearchResultsProps) {
  const t = useTranslations('search')
  const locale = useLocale() as Locale

  if (loading) {
    return (
      <section className="bg-texture-sand py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-white shadow-2xl overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-[#e5e7eb]" />
                <div className="p-5 space-y-3">
                  <div className="h-4 bg-[#e5e7eb] rounded w-3/4" />
                  <div className="h-3 bg-[#e5e7eb] rounded w-full" />
                  <div className="h-3 bg-[#e5e7eb] rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    )
  }

  const formattedDate = date ? formatDate(new Date(date + 'T00:00:00'), locale) : ''

  return (
    <section className="bg-texture-sand py-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <h2 className="font-briston text-[36px] sm:text-[48px] text-primary leading-none">
            {t('resultsTitle', { date: formattedDate })}
          </h2>
          {results.length > 0 && (
            <p className="font-avenir text-muted mt-1">
              {t('resultsSubtitle', { count: results.length })}
            </p>
          )}
        </div>

        {results.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-palmore text-2xl text-primary">{t('noResults')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map(result => (
              <SearchResultCard
                key={result.listing.id}
                result={result}
                locale={locale}
                date={date}
                guests={guests}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
