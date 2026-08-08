import { Toaster } from 'sonner'
import ProtectedLayout from '@/components/auth/ProtectedLayout'
import DashboardSidebar from '@/components/layout/DashboardSidebar'
import type { NavSection } from '@/components/layout/DashboardSidebar'
import { AdminDataPreloader } from '@/components/admin/AdminDataPreloader'
import { VoiceProvider } from '@/components/admin/VoiceProvider'
import { VoicePhone } from '@/components/admin/VoicePhone'
import { AiOpsCenter } from '@/components/admin/AiOpsCenter'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

const navSections: NavSection[] = [
  {
    label: 'Operations',
    items: [
      { href: '/admin/bookings',  label: 'Bookings',  icon: 'bookings' },
      { href: '/admin/inbox',     label: 'Inbox',     icon: 'inbox',     badge: 'inbox-open-count' },
      { href: '/admin/catering',  label: 'Catering',  icon: 'catering',  badge: 'pending-catering-count' },
      { href: '/admin/planning',  label: 'Planning',  icon: 'planning' },
      { href: '/admin/scheduling', label: 'Availability', icon: 'schedule' },
      { href: '/admin/maintenance', label: 'Maintenance', icon: 'maintenance' },
      { href: '/admin/stock',      label: 'Stock',      icon: 'stock' },
      { href: '/admin/customers', label: 'Customers', icon: 'customers', comingSoon: true },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/homepage',   label: 'Homepage',   icon: 'images' },
      { href: '/admin/boats',      label: 'Boats',      icon: 'cruises' },
      { href: '/admin/cruises',    label: 'Cruises',    icon: 'cruises' },
      { href: '/admin/extras',     label: 'Extras',     icon: 'extras' },
      { href: '/admin/reviews',    label: 'Reviews',    icon: 'reviews' },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/admin/campaigns',    label: 'Campaigns',    icon: 'campaigns' },
      { href: '/admin/partners',     label: 'Partners',     icon: 'campaigns' },
      { href: '/admin/promo-codes',  label: 'Promo Codes',  icon: 'promocodes' },
      { href: '/admin/blog',         label: 'Blog',         icon: 'blog',      comingSoon: true },
    ],
  },
  {
    label: 'Performance',
    items: [
      { href: '/admin/statistics', label: 'Statistics', icon: 'statistics' },
      { href: '/admin/google-ads', label: 'Google Ads', icon: 'campaigns' },
      { href: '/admin/finance',    label: 'Finance',    icon: 'finance' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/admin/users', label: 'Users', icon: 'users' },
    ],
  },
  {
    label: 'Dev',
    items: [
      { href: '/admin/ghost',               label: 'Ghost AI',              icon: 'ghost' },
      { href: '/admin/notifications',       label: 'Notifications',         icon: 'notifications' },
      { href: '/admin/fareharbor',          label: 'FareHarbor API',        icon: 'fareharbor' },
      { href: '/admin/fareharbor-settings', label: 'FH Settings',           icon: 'fareharbor' },
      { href: '/admin/connections',        label: 'Other API Connections', icon: 'connections',  comingSoon: true },
      { href: '/admin/review-tool',        label: 'Review Tool',           icon: 'reviewtool',  comingSoon: true },
      { href: '/admin/image-optimization', label: 'Image Optimization',    icon: 'images' },
    ],
  },
]

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin']} locale={locale}>
      {(profile) => (
        <VoiceProvider>
          <div data-admin className="flex h-screen overflow-hidden bg-zinc-50 font-sans">
            <AdminDataPreloader />
            <DashboardSidebar locale={locale} profile={profile} portalName="Admin Panel" navSections={navSections} />
            <main className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-end px-4 py-2 border-b border-zinc-100 bg-white shrink-0">
                <AiOpsCenter locale={locale} />
              </div>
              <div className="flex-1 overflow-auto">{children}</div>
            </main>
            <VoicePhone />
            <Toaster richColors position="bottom-right" />
          </div>
        </VoiceProvider>
      )}
    </ProtectedLayout>
  )
}
