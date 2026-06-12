'use client'

/**
 * Shown across the portal when the logged-in user has no staff record yet
 * (staff.user_id not pointing at their profile). The admin links accounts
 * on /admin/scheduling → Staff → edit → "Linked login".
 */
export function Unlinked() {
  return (
    <div className="max-w-md mx-auto mt-16 text-center space-y-3 px-4">
      <p className="text-4xl">⚓️</p>
      <h2 className="text-lg font-semibold text-zinc-900">Almost aboard</h2>
      <p className="text-sm text-zinc-500">
        Your login works, but it isn’t linked to a crew member yet. Ask Beer to
        link your account in the admin (Scheduling → Staff), then refresh this page.
      </p>
    </div>
  )
}

export function isUnlinked(error: string | null): boolean {
  return error === 'unlinked'
}
