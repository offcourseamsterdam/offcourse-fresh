'use client'

import { useAuth } from '@/lib/auth/hooks'

interface Props {
  locale: string
  className?: string
  style?: React.CSSProperties
  /** Icon-only variant (sidebar footer) — pass the icon as children, gets an aria-label instead of visible text. */
  iconOnly?: boolean
  children?: React.ReactNode
}

export default function AdminSignOutButton({ locale, className, style, iconOnly, children }: Props) {
  const { signOut } = useAuth()

  async function handleSignOut() {
    await signOut()
    window.location.href = `/${locale}`
  }

  if (iconOnly) {
    return (
      <button
        onClick={handleSignOut}
        aria-label="Sign out"
        title="Sign out"
        className={className}
        style={style}
      >
        {children}
      </button>
    )
  }

  return (
    <button
      onClick={handleSignOut}
      className={className ?? 'text-xs text-white/60 hover:text-white transition-colors'}
      style={style}
    >
      Sign out
    </button>
  )
}
