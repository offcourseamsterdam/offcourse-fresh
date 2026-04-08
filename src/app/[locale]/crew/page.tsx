import Image from 'next/image'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'

type Person = Database['public']['Tables']['people']['Row']

export const revalidate = 60

interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'crew' })
  return {
    title: `${t('pageTitle')} — Off Course Amsterdam`,
    description: t('pageSubtitle'),
  }
}

export default async function CrewPage({ params }: Props) {
  const t = await getTranslations('crew')
  const supabase = await createClient()

  const { data: peopleData } = await supabase
    .from('people')
    .select('*')
    .order('display_order', { ascending: true })
  const people = peopleData as Person[] | null
  const team = people?.filter(p => p.type === 'team') ?? []
  const floatFam = people?.filter(p => p.type === 'float_fam') ?? []

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-[var(--color-primary)] text-white py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-black mb-4">{t('pageTitle')}</h1>
          <p className="text-white/70 text-lg max-w-xl mx-auto">{t('pageSubtitle')}</p>
        </div>
      </div>

      {/* Team */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {team.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 mb-20">
            {team.map(member => (
              <article key={member.id} className="text-center">
                <div className="relative w-40 h-40 mx-auto mb-4 rounded-full overflow-hidden bg-[var(--color-sand)]">
                  {member.image_url ? (
                    <Image
                      src={member.image_url}
                      alt={member.name}
                      fill
                      className="object-cover"
                      sizes="160px"
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-3xl font-black text-[var(--color-primary)]/30">
                      {member.name.charAt(0)}
                    </div>
                  )}
                </div>
                <h2 className="font-bold text-[var(--color-primary)] text-lg">{member.name}</h2>
                <p className="text-sm text-[var(--color-accent)] font-medium mb-2">{member.role}</p>
                {member.bio && (
                  <p className="text-sm text-[var(--color-muted)] leading-relaxed">{member.bio}</p>
                )}
              </article>
            ))}
          </div>
        )}

        {/* Float Fam */}
        {floatFam.length > 0 && (
          <section>
            <div className="text-center mb-10">
              <h2 className="text-3xl font-black text-[var(--color-primary)]">{t('floatFam.title')}</h2>
              <p className="text-[var(--color-muted)] mt-2">{t('floatFam.subtitle')}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-4">
              {floatFam.map(member => (
                <div key={member.id} className="text-center">
                  <div className="relative w-16 h-16 mx-auto mb-2 rounded-full overflow-hidden bg-[var(--color-sand)]">
                    {member.image_url ? (
                      <Image src={member.image_url} alt={member.name} fill className="object-cover" sizes="64px" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-lg font-black text-[var(--color-primary)]/30">
                        {member.name.charAt(0)}
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-[var(--color-primary)]">{member.name}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
