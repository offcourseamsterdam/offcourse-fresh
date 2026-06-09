import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/utils'
import type { Locale } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'

type MerchProduct = Database['public']['Tables']['merch_products']['Row']
type MerchImage = { url: string; alt_text?: string | null }

export const revalidate = 60

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'merch' })
  return {
    title: `${t('pageTitle')} — Off Course Amsterdam`,
    description: t('pageSubtitle'),
  }
}

export default async function MerchPage({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations('merch')
  const supabase = await createClient()

  const { data: productsData } = await supabase
    .from('merch_products')
    .select('*')
    .eq('is_active', true)
    .order('display_order', { ascending: true })
  const products = productsData as MerchProduct[] | null

  return (
    <div className="min-h-screen bg-[var(--color-sand)]">
      {/* Header */}
      <div className="bg-[var(--color-primary)] text-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">{t('pageTitle')}</h1>
          <p className="text-white/70 text-lg max-w-xl mx-auto">{t('pageSubtitle')}</p>
        </div>
      </div>

      {/* Products grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {!products || products.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-[var(--color-muted)] text-lg">{t('comingSoon')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
            {products.map(product => {
              const images = (product.images as MerchImage[] | null) ?? []
              const heroImg = images[0]

              return (
                <article key={product.id} className="bg-white rounded-2xl overflow-hidden shadow-sm group">
                  <div className="relative aspect-square bg-gray-100">
                    {heroImg ? (
                      <Image
                        src={heroImg.url}
                        alt={heroImg.alt_text ?? product.name ?? ''}
                        fill
                        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                        className="object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-primary)]/20 to-transparent flex items-center justify-center">
                        <span className="text-4xl font-black text-[var(--color-primary)]/20">OC</span>
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <h2 className="font-bold text-[var(--color-primary)] mb-1">{product.name}</h2>
                    {product.description && (
                      <p className="text-sm text-[var(--color-muted)] mb-3 line-clamp-2">{product.description}</p>
                    )}
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-lg text-[var(--color-primary)]">
                        {formatPrice(product.price, locale as Locale)}
                      </p>
                      {(() => {
                        const sizes = (['S', 'M', 'L', 'XL'] as const).filter((s, i) => {
                          const stocks = [product.stock_s, product.stock_m, product.stock_l, product.stock_xl]
                          return stocks[i] != null && stocks[i]! > 0
                        })
                        return sizes.length > 0 ? (
                          <div className="flex gap-1">
                            {sizes.map(size => (
                              <span key={size} className="text-xs bg-[var(--color-sand)] text-[var(--color-primary)] font-medium px-2 py-0.5 rounded">
                                {size}
                              </span>
                            ))}
                          </div>
                        ) : null
                      })()}
                    </div>
                    <button className="mt-3 w-full bg-[var(--color-primary)] text-white font-semibold py-2.5 rounded-xl text-sm hover:opacity-90 transition-opacity">
                      {t('addToCart')}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
