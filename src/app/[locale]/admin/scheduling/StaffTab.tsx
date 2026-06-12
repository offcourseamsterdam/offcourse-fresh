'use client'

import { useState } from 'react'
import { Loader2, Plus, RefreshCw, Pencil, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { fmtEuros } from '@/lib/utils'
import { StaffFormModal, type StaffRow, type CaptainProfile } from './StaffFormModal'

export function StaffTab() {
  const { data, isLoading, error, refresh } = useAdminFetch<{
    staff: StaffRow[]
    captainProfiles: CaptainProfile[]
  }>('/api/admin/scheduling/staff')
  const staff = data?.staff ?? []
  const captainProfiles = data?.captainProfiles ?? []

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<StaffRow | null>(null)

  function openCreate() {
    setEditing(null)
    setShowForm(true)
  }

  function openEdit(s: StaffRow) {
    setEditing(s)
    setShowForm(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={refresh} disabled={isLoading}>
          {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span className="hidden sm:inline">Refresh</span>
        </Button>
        <Button size="sm" onClick={openCreate}>
          <Plus className="w-3.5 h-3.5" />
          Add staff
        </Button>
      </div>

      <AdminErrorBanner error={error} />

      {isLoading && staff.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading staff…
        </div>
      )}

      {!isLoading && staff.length === 0 && !error && (
        <div className="text-center py-16 text-zinc-400 text-sm space-y-2">
          <p className="text-3xl">🧑‍✈️</p>
          <p>No staff yet. Add your first skipper.</p>
        </div>
      )}

      {staff.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Rate</th>
                <th className="px-4 py-3 font-medium">Slack</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.id} className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/50">
                  <td className="px-4 py-3">
                    <span className="font-medium text-zinc-900">{s.name}</span>
                    {s.user_id && (
                      <span className="ml-2 text-[10px] text-zinc-400" title="Has portal login">login</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600 capitalize">{s.role}</td>
                  <td className="px-4 py-3 text-zinc-600">{fmtEuros(s.hourly_rate_cents)}/h</td>
                  <td className="px-4 py-3">
                    {s.slack_member_id ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                        <Link2 className="w-3 h-3" /> linked
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium ${
                        s.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
                      }`}
                    >
                      {s.is_active ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(s)}
                      className="p-2.5 rounded hover:bg-zinc-100 text-zinc-400 hover:text-zinc-600 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <StaffFormModal
          editing={editing}
          captainProfiles={captainProfiles}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); refresh() }}
        />
      )}
    </div>
  )
}
