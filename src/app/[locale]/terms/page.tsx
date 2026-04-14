import { getTranslations } from 'next-intl/server'

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'terms' })
  return {
    title: `${t('pageTitle')} — Off Course Amsterdam`,
    robots: { index: false },
  }
}

export default async function TermsPage() {
  const t = await getTranslations('terms')

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
          <h2>1. The service</h2>
          <p>
            Off Course Amsterdam offers private and shared electric boat tours in Amsterdam.
            By making a booking, you agree to these terms.
          </p>

          <h2>2. Bookings</h2>
          <p>
            Bookings are confirmed once payment is received. You will receive a confirmation email with your booking details.
            The skipper has the right to refuse boarding if guests are excessively intoxicated or behave unsafely.
          </p>

          <h2>3. Cancellation policy</h2>
          <ul>
            <li><strong>More than 48 hours before departure:</strong> Full refund</li>
            <li><strong>24–48 hours before departure:</strong> 50% refund</li>
            <li><strong>Less than 24 hours before departure:</strong> No refund</li>
          </ul>
          <p>
            We reserve the right to cancel due to extreme weather conditions. In this case you will receive a full refund
            or the option to reschedule.
          </p>

          <h2>4. Capacity and guests</h2>
          <p>
            Diana holds a maximum of 8 guests. Curaçao holds a maximum of 12 guests.
            Exceeding these limits is not permitted.
          </p>

          <h2>5. Your responsibility</h2>
          <p>
            Guests are responsible for their behaviour on board. Damage caused by guests will be charged.
            All guests swim at their own risk — we are not liable for accidents.
          </p>

          <h2>6. Bringing food & drinks</h2>
          <p>
            You are welcome to bring your own food and drinks. Glass bottles are allowed but please handle them responsibly.
          </p>

          <h2>7. Contact</h2>
          <p>
            Questions about these terms? Email{' '}
            <a href="mailto:info@offcourseamsterdam.com" className="text-[var(--color-primary)] underline">
              info@offcourseamsterdam.com
            </a>.
          </p>
        </div>
      </div>
    </div>
  )
}
