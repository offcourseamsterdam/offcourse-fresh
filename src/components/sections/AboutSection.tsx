import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/ui/button'

export async function AboutSection() {
  const t = await getTranslations('home.about')

  return (
    <section className="bg-[var(--color-primary)] py-16 sm:py-20 overflow-hidden relative">
      {/* Decorative wave */}
      <div className="absolute top-0 left-0 right-0">
        <svg viewBox="0 0 1440 40" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
          <path d="M0 0 Q360 40 720 20 Q1080 0 1440 40 L1440 0 Z" fill="white" />
        </svg>
      </div>

      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <p className="text-[var(--color-accent)] text-sm font-semibold uppercase tracking-[0.15em] mb-4">
          {t('label')}
        </p>
        <h2 className="text-3xl sm:text-4xl font-black text-white mb-6">
          {t('title')}
        </h2>
        <p className="text-white/80 text-lg leading-relaxed mb-4">
          {t('body')}
        </p>
        <p className="text-white/60 text-base leading-relaxed mb-10">
          {t('body2')}
        </p>
        <Link href="/crew">
          <Button variant="outline" size="md" className="border-white text-white hover:bg-white hover:text-[var(--color-primary)]">
            {t('cta')}
          </Button>
        </Link>
      </div>
    </section>
  )
}
