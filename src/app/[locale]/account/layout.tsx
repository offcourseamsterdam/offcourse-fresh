import Link from 'next/link'
import ProtectedLayout from '@/components/auth/ProtectedLayout'
import type { UserProfile } from '@/lib/auth/types'
import AdminSignOutButton from '@/components/auth/AdminSignOutButton'

interface Props {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

const navItems = [
  { href: '/account',          label: 'My Bookings', icon: '📅' },
  { href: '/account/profile',  label: 'Profile',     icon: '👤' },
]

function AccountNav({ locale, profile }: { locale: string; profile: UserProfile }) {
  return (
    <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <span className="font-semibold text-[var(--color-primary)]">My Account</span>
        <nav className="flex gap-4">
          {navItems.map(item => (
            <Link
              key={item.href}
              href={`/${locale}${item.href}`}
              className="text-sm text-gray-500 hover:text-[var(--color-primary)] transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-400">{profile.display_name || profile.email}</span>
        <AdminSignOutButton locale={locale} />
      </div>
    </header>
  )
}

export default async function AccountLayout({ children, params }: Props) {
  const { locale } = await params

  return (
    <ProtectedLayout allowedRoles={['admin', 'support', 'captain', 'guest', 'partner']} locale={locale}>
      {(profile) => (
        <div className="min-h-screen bg-gray-50">
          <AccountNav locale={locale} profile={profile} />
          <main className="max-w-4xl mx-auto px-6 py-10">
            {children}
          </main>
        </div>
      )}
    </ProtectedLayout>
  )
}
