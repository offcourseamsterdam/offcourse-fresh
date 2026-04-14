'use client'

import { useAuth } from '@/lib/auth/hooks'

export default function AdminSignOutButton({ locale }: { locale: string }) {
  const { signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    window.location.href = `/${locale}`
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-xs text-white/60 hover:text-white transition-colors"
    >
      Sign out
    </button>
  )
}
