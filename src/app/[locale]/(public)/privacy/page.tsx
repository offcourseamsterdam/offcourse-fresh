import { getTranslations } from 'next-intl/server'

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'privacy' })
  return {
    title: `${t('pageTitle')} — Off Course Amsterdam`,
    robots: { index: false },
  }
}

export default async function PrivacyPage() {
  const t = await getTranslations('privacy')

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className="text-3xl sm:text-4xl font-black text-[var(--color-primary)] mb-2">
          {t('pageTitle')}
        </h1>
        <p className="text-sm text-[var(--color-muted)] mb-10">
          {t('lastUpdated', { date: 'April 2025' })}
        </p>

        <div className="prose prose-neutral max-w-none text-[var(--color-foreground)]">
          <h2>1. Who we are</h2>
          <p>
            Off Course Amsterdam is an electric boat tour company based in Amsterdam, Netherlands.
            We operate under the trade name Off Course and are registered at Keizersgracht 62, Amsterdam.
          </p>

          <h2>2. What data we collect</h2>
          <p>When you make a booking, we collect:</p>
          <ul>
            <li>Your name and email address</li>
            <li>Phone number (optional)</li>
            <li>Payment information (processed securely by Stripe — we do not store card details)</li>
            <li>Booking preferences and special requests</li>
          </ul>

          <h2>3. How we use your data</h2>
          <p>We use your data to:</p>
          <ul>
            <li>Process and confirm your booking</li>
            <li>Send booking confirmations and reminders</li>
            <li>Provide customer support</li>
            <li>Comply with legal obligations</li>
          </ul>

          <h2>4. Who we share your data with</h2>
          <p>
            We share your booking details with FareHarbor (our booking management platform) to process your reservation.
            Payments are processed by Stripe. We do not sell your personal data to third parties.
          </p>

          <h2>5. Your rights</h2>
          <p>
            Under GDPR, you have the right to access, correct, or delete your personal data.
            To exercise these rights, contact us at{' '}
            <a href="mailto:info@offcourseamsterdam.com" className="text-[var(--color-primary)] underline">
              info@offcourseamsterdam.com
            </a>.
          </p>

          <h2>6. Cookies</h2>
          <p>
            We use essential cookies only (session management). We do not use advertising cookies or third-party tracking pixels.
          </p>

          <h2>7. Contact</h2>
          <p>
            Questions? Email us at{' '}
            <a href="mailto:info@offcourseamsterdam.com" className="text-[var(--color-primary)] underline">
              info@offcourseamsterdam.com
            </a>
            {' '}or message us on{' '}
            <a href="https://wa.me/31645351618" target="_blank" rel="noopener noreferrer" className="text-[var(--color-primary)] underline">
              WhatsApp
            </a>.
          </p>
        </div>
      </div>
    </div>
  )
}
