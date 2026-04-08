import ProtectedLayout from '@/components/auth/ProtectedLayout'
import DashboardSidebar from '@/components/layout/DashboardSidebar'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

const navSections = [
  { label: 'Partner', items: [
    { href: '/partner',            label: 'Overview',       icon: 'dashboard' },
    { href: '/partner/reports',    label: 'Reports',        icon: 'statistics' },
    { href: '/partner/invoices',   label: 'Invoices',       icon: 'bookings' },
    { href: '/partner/campaigns',  label: 'Campaign Links', icon: 'campaigns' },
  ]},
]

export default async function PartnerLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin', 'partner']} locale={locale}>
      {(profile) => (
        <div className="flex min-h-screen">
          <DashboardSidebar locale={locale} profile={profile} portalName="Partner Portal" navSections={navSections} />
          <main className="flex-1 bg-gray-50 overflow-auto">{children}</main>
        </div>
      )}
    </ProtectedLayout>
  )
}
