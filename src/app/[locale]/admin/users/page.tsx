'use client'

import { useEffect, useState } from 'react'
import { VALID_ROLES } from '@/lib/auth/types'
import type { UserProfile, UserRole } from '@/lib/auth/types'

const roleBadgeColors: Record<UserRole, string> = {
  admin:   'bg-red-100 text-red-700',
  support: 'bg-blue-100 text-blue-700',
  captain: 'bg-indigo-100 text-indigo-700',
  partner: 'bg-purple-100 text-purple-700',
  guest:   'bg-gray-100 text-gray-600',
}

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<UserRole>('support')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteMessage, setInviteMessage] = useState<string | null>(null)

  async function loadUsers() {
    setLoading(true)
    const res = await fetch('/api/admin/users')
    const data = await res.json()
    if (data.error) {
      setError(data.error)
    } else {
      setUsers(data.users)
    }
    setLoading(false)
  }

  useEffect(() => { loadUsers() }, [])

  async function updateUser(id: string, patch: { role?: UserRole; is_active?: boolean }) {
    const res = await fetch('/api/admin/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    const data = await res.json()
    if (!data.error) {
      setUsers(prev => prev.map(u => u.id === id ? { ...u, ...patch } : u))
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviteLoading(true)
    setInviteMessage(null)
    const res = await fetch('/api/admin/users/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })
    const data = await res.json()
    setInviteLoading(false)
    if (data.error) {
      setInviteMessage(`Error: ${data.error}`)
    } else {
      setInviteMessage(`Invite sent to ${inviteEmail}`)
      setInviteEmail('')
      loadUsers()
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[var(--color-primary)] mb-6">Users</h1>

      {/* Invite form */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 mb-8">
        <h2 className="font-semibold text-[var(--color-primary)] mb-4">Invite team member</h2>
        <form onSubmit={handleInvite} className="flex gap-3 flex-wrap items-end">
          <div className="flex-1 min-w-48">
            <label className="block text-xs text-gray-400 mb-1">Email</label>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="name@example.com"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Role</label>
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as UserRole)}
              className="px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
            >
              {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <button
            type="submit"
            disabled={inviteLoading}
            className="px-4 py-2 bg-[var(--color-primary)] text-white text-sm rounded-lg disabled:opacity-50"
          >
            {inviteLoading ? 'Sending...' : 'Send invite'}
          </button>
        </form>
        {inviteMessage && (
          <p className="mt-2 text-sm text-gray-500">{inviteMessage}</p>
        )}
      </div>

      {/* User table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <p className="text-gray-400 text-sm p-6">Loading...</p>
        ) : error ? (
          <p className="text-red-500 text-sm p-6">{error}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left">
                <th className="px-6 py-3 text-xs font-medium text-gray-400 uppercase">User</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-400 uppercase">Role</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-400 uppercase">Status</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-400 uppercase">Joined</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => (
                <tr key={user.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-6 py-4">
                    <p className="font-medium text-[var(--color-primary)]">
                      {user.display_name || '—'}
                    </p>
                    <p className="text-gray-400 text-xs">{user.email}</p>
                  </td>
                  <td className="px-6 py-4">
                    <select
                      value={user.role}
                      onChange={e => updateUser(user.id, { role: e.target.value as UserRole })}
                      className={`text-xs px-2 py-1 rounded-full font-medium border-0 cursor-pointer ${roleBadgeColors[user.role]}`}
                    >
                      {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => updateUser(user.id, { is_active: !user.is_active })}
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        user.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-gray-400 text-xs">
                    {new Date(user.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
