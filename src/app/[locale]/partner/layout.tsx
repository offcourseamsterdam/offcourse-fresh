import ProtectedLayout from '@/components/auth/ProtectedLayout'
import DashboardSidebar from '@/components/layout/DashboardSidebar'
import { PartnerContext } from './PartnerContext'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

const navSections = [
  { label: 'Partner', items: [
    { href: '/partner',            label: 'Overview',    icon: 'dashboard' },
    { href: '/partner/bookings',   label: 'Bookings',    icon: 'bookings' },
    { href: '/partner/campaigns',  label: 'Campaigns',   icon: 'campaigns' },
    { href: '/partner/commission', label: 'Commission',  icon: 'statistics' },
    { href: '/partner/settings',   label: 'Settings',    icon: 'settings' },
  ]},
]

export default async function PartnerLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin', 'partner']} locale={locale}>
      {(profile) => (
        <div className="flex min-h-screen">
          <DashboardSidebar locale={locale} profile={profile} portalName="Partner Portal" navSections={navSections} />
          <main className="flex-1 bg-gray-50 overflow-auto">
            <PartnerContext profile={profile} />
            {children}
          </main>
        </div>
      )}
    </ProtectedLayout>
  )
}
