import ProtectedLayout from '@/components/auth/ProtectedLayout'
import DashboardSidebar from '@/components/layout/DashboardSidebar'
import type { NavSection } from '@/lib/admin/nav-sections'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

const navSections: NavSection[] = [
  { label: 'Support', color: '#9bb7fd', ink: '#34449a', items: [
    { href: '/support',           label: 'Dashboard',   icon: 'dashboard' },
    { href: '/support/bookings',  label: 'Bookings',    icon: 'bookings' },
    { href: '/support/content',   label: 'Content',     icon: 'blog' },
    { href: '/support/operations',label: 'Operations',  icon: 'integrations' },
  ]},
]

export default async function SupportLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin', 'support']} locale={locale}>
      {(profile) => (
        <div className="flex min-h-screen">
          <DashboardSidebar locale={locale} profile={profile} portalName="Support Portal" navSections={navSections} />
          <main className="flex-1 bg-gray-50 overflow-auto">{children}</main>
        </div>
      )}
    </ProtectedLayout>
  )
}
