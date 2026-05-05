import ProtectedLayout from '@/components/auth/ProtectedLayout'
import { PartnerContext } from './PartnerContext'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

export default async function PartnerLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin', 'partner']} locale={locale}>
      {(profile) => (
        <div className="min-h-screen bg-gray-50">
          <PartnerContext profile={profile} />
          <main className="overflow-auto">
            {children}
          </main>
        </div>
      )}
    </ProtectedLayout>
  )
}
