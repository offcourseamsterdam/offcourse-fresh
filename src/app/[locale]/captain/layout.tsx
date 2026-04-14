import ProtectedLayout from '@/components/auth/ProtectedLayout'
import DashboardSidebar from '@/components/layout/DashboardSidebar'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

const navSections = [
  { label: 'Captain', items: [
    { href: '/captain',          label: 'My Schedule', icon: 'bookings' },
    { href: '/captain/trips',    label: 'Trip Details', icon: 'cruises' },
    { href: '/captain/profile',  label: 'Profile',      icon: 'users' },
  ]},
]

export default async function CaptainLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin', 'captain']} locale={locale}>
      {(profile) => (
        <div className="flex min-h-screen">
          <DashboardSidebar locale={locale} profile={profile} portalName="Captain Portal" navSections={navSections} />
          <main className="flex-1 bg-gray-50 overflow-auto">{children}</main>
        </div>
      )}
    </ProtectedLayout>
  )
}
