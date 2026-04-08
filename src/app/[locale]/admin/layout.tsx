import ProtectedLayout from '@/components/auth/ProtectedLayout'
import DashboardSidebar from '@/components/layout/DashboardSidebar'
import type { NavSection } from '@/components/layout/DashboardSidebar'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

const navSections: NavSection[] = [
  {
    label: 'Operations',
    items: [
      { href: '/admin/bookings',   label: 'Bookings',   icon: 'bookings' },
      { href: '/admin/planning',   label: 'Planning',   icon: 'planning',   comingSoon: true },
      { href: '/admin/customers',  label: 'Customers',  icon: 'customers',  comingSoon: true },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/homepage',   label: 'Homepage',   icon: 'images' },
      { href: '/admin/boats',      label: 'Boats',      icon: 'cruises' },
      { href: '/admin/cruises',    label: 'Cruises',    icon: 'cruises' },
      { href: '/admin/extras',     label: 'Extras',     icon: 'extras' },
      { href: '/admin/reviews',    label: 'Reviews',    icon: 'reviews',    comingSoon: true },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/admin/blog',      label: 'Blog',                 icon: 'blog',      comingSoon: true },
      { href: '/admin/campaigns', label: 'Campaigns & Partners', icon: 'campaigns' },
    ],
  },
  {
    label: 'Performance',
    items: [
      { href: '/admin/statistics', label: 'Statistics', icon: 'statistics' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/admin/users', label: 'Users', icon: 'users', comingSoon: true },
    ],
  },
  {
    label: 'Dev',
    items: [
      { href: '/admin/fareharbor',         label: 'FareHarbor API',        icon: 'fareharbor' },
      { href: '/admin/connections',        label: 'Other API Connections', icon: 'connections',  comingSoon: true },
      { href: '/admin/review-tool',        label: 'Review Tool',           icon: 'reviewtool' },
      { href: '/admin/image-optimization', label: 'Image Optimization',    icon: 'images' },
    ],
  },
]

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin']} locale={locale}>
      {(profile) => (
        <div data-admin className="flex min-h-screen bg-zinc-50 font-sans">
          <DashboardSidebar locale={locale} profile={profile} portalName="Admin Panel" navSections={navSections} />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      )}
    </ProtectedLayout>
  )
}
