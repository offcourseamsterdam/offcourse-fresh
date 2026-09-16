import { Toaster } from 'sonner'
import { DM_Sans } from 'next/font/google'
import ProtectedLayout from '@/components/auth/ProtectedLayout'
import DashboardSidebar from '@/components/layout/DashboardSidebar'
import { AdminDataPreloader } from '@/components/admin/AdminDataPreloader'
import { VoiceProvider } from '@/components/admin/VoiceProvider'
import { VoicePhone } from '@/components/admin/VoicePhone'
import { AiOpsCenter } from '@/components/admin/AiOpsCenter'
import { navSections } from '@/lib/admin/nav-sections'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

// The admin's own UI face — separate from the homepage's Briston/Avenir/Palmore
// (see src/app/layout.tsx). Loaded only under this route segment so the public
// site never downloads it. Nav structure + section colors live in
// src/lib/admin/nav-sections.ts.
const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-admin-sans',
  display: 'swap',
})

export default async function AdminLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin']} locale={locale}>
      {(profile) => (
        <VoiceProvider>
          <div data-admin className={`${dmSans.variable} flex h-screen overflow-hidden bg-[var(--admin-bg)] font-sans`}>
            <AdminDataPreloader />
            <DashboardSidebar locale={locale} profile={profile} portalName="Admin Panel" navSections={navSections} />
            <main className="flex-1 flex flex-col overflow-hidden">
              <div className="flex items-center justify-end px-4 py-2 border-b border-[var(--admin-border)] bg-[var(--admin-bg)] shrink-0">
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
