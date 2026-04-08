import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'

export default async function NotFound() {
  const t = await getTranslations('404')

  return (
    <div className="min-h-screen bg-[var(--color-sand)] flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-[var(--color-primary)]/10 mb-2 leading-none">
          404
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-[var(--color-primary)] mb-3">
          {t('title')}
        </h1>
        <p className="text-[var(--color-muted)] mb-8">
          {t('subtitle')}
        </p>
        <Link
          href="/"
          className="inline-flex items-center gap-2 bg-[var(--color-primary)] text-white font-semibold px-6 py-3 rounded-xl hover:opacity-90 transition-opacity"
        >
          ← {t('cta')}
        </Link>
      </div>
    </div>
  )
}
