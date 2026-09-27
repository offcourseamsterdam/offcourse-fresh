import Image from 'next/image'
import { getTranslations } from 'next-intl/server'

interface Partner {
  name: string
  url: string
  logo: string
  logoBg: string
  description: string
}

// Backlink-exchange partners — dofollow both ways is the point, so links below
// deliberately carry no rel="nofollow"/"sponsored".
const PARTNERS: Partner[] = [
  {
    name: 'BoatLocal',
    url: 'https://boatlocal.nl',
    logo: '/partners/boatlocal-logo.webp',
    logoBg: '#091747',
    description: "Amsterdam's boat tour marketplace — a good spot to browse other ways to get on the water.",
  },
]

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'partners' })
  return {
    title: `${t('pageTitle')} — Off Course Amsterdam`,
    description: t('pageSubtitle'),
  }
}

export default async function PartnersPage() {
  const t = await getTranslations('partners')

  return (
    <div className="min-h-screen bg-[var(--color-sand)]">
      {/* Header */}
      <div className="bg-[var(--color-primary)] text-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">{t('pageTitle')}</h1>
          <p className="text-white/70 text-lg max-w-xl mx-auto">{t('pageSubtitle')}</p>
        </div>
      </div>

      {/* Partners grid */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
          {PARTNERS.map(partner => (
            <a
              key={partner.name}
              href={partner.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 flex flex-col"
            >
              <div
                className="flex items-center justify-center h-40 px-10"
                style={{ backgroundColor: partner.logoBg }}
              >
                <div className="relative w-full max-w-[220px] h-14 group-hover:scale-105 transition-transform duration-300">
                  <Image
                    src={partner.logo}
                    alt={`${partner.name} logo`}
                    fill
                    sizes="220px"
                    className="object-contain"
                  />
                </div>
              </div>
              <div className="flex flex-col flex-1 p-6">
                <h2 className="font-bold text-[var(--color-primary)] text-xl mb-2">{partner.name}</h2>
                <p className="text-sm text-[var(--color-muted)] leading-relaxed mb-6 flex-1">{partner.description}</p>
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-accent)]">
                  {t('visitWebsite')}
                  <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
