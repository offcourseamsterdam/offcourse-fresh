'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { UserProfile } from '@/lib/auth/types'

/**
 * When an admin visits the partner portal with ?pid=<partner_id>:
 * 1. Persists the pid as a cookie so all sub-pages use it (no need for ?pid= on every link)
 * 2. Shows a banner with the partner name so the admin knows whose portal they're viewing
 * 3. Shows a "Back to admin" link
 */
export function PartnerContext({ profile }: { profile: { role: string } }) {
  const searchParams = useSearchParams()
  const pid = searchParams.get('pid')
  const isAdmin = profile.role === 'admin'
  const [partnerName, setPartnerName] = useState<string | null>(null)

  // Persist pid as cookie when admin navigates to partner portal
  useEffect(() => {
    if (!isAdmin) return

    if (pid) {
      // Set cookie for 24 hours (admin session viewing a partner)
      document.cookie = `oc_admin_pid=${pid};path=/;max-age=86400;SameSite=Lax`
    }

    // Fetch partner name from pid (cookie or URL)
    const activePid = pid ?? getCookie('oc_admin_pid')
    if (activePid) {
      fetch(`/api/admin/partners/${activePid}`)
        .then(r => r.json())
        .then(json => {
          if (json.ok) setPartnerName(json.data?.partner?.name ?? null)
        })
        .catch(() => {})
    }
  }, [pid, isAdmin])

  // Don't show banner for partner users (they're always in their own portal)
  if (!isAdmin) return null

  // Don't show if no partner selected
  if (!partnerName && !pid) {
    return (
      <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-sm text-amber-800 flex items-center justify-between">
        <span>No partner selected — go to <a href="/en/admin/partners" className="underline font-medium">Partners</a> and click the 🔗 icon to view a specific partner&apos;s portal.</span>
      </div>
    )
  }

  return (
    <div className="bg-[var(--color-primary)] text-white px-6 py-2.5 text-sm flex items-center justify-between">
      <span>
        Viewing as: <strong>{partnerName ?? 'Loading...'}</strong>
      </span>
      <a
        href="/en/admin/partners"
        className="text-white/80 hover:text-white underline text-xs"
      >
        ← Back to admin
      </a>
    </div>
  )
}

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
