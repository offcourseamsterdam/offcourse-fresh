'use client'

import { useState } from 'react'
import { Loader2, Handshake, ExternalLink, Plus } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import type { AdminPartner } from '@/lib/admin/types'
import { PeriodSelector, getDateRange, type PeriodKey } from '@/components/admin/tracking/PeriodSelector'
import { PartnerModal } from '@/components/admin/tracking/PartnerModal'


export default function PartnersPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [dateRange, setDateRange] = useState(getDateRange('30d'))
  const [showModal, setShowModal] = useState(false)

  const trackingParams = new URLSearchParams({ from: dateRange.from, to: dateRange.to })
  const { data: partnersData, isLoading: loading, refresh } =
    useAdminFetch<AdminPartner[]>(`/api/admin/tracking/partners?${trackingParams}`)
  const partners = partnersData ?? []

  return (
    <div className="p-6 sm:p-8 max-w-7xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center">
            <Handshake className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-zinc-900">Partners</h1>
            <p className="text-xs text-zinc-400">Partners, commissions & reporting</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector value={period} onChange={(key, from, to) => { setPeriod(key); setDateRange({ from, to }) }} />
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 transition-colors">
            <Plus className="w-3.5 h-3.5" /> New Partner
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
        </div>
      ) : partners.length === 0 ? (
        <div className="text-center py-20 text-sm text-zinc-400">
          No partners yet. Add a partner to start tracking referrals.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 text-zinc-400 uppercase tracking-wider border-b border-zinc-200">
                <th className="text-left px-5 py-3 font-medium">Partner</th>
                <th className="text-left px-5 py-3 font-medium hidden sm:table-cell">Email</th>
                <th className="text-right px-5 py-3 font-medium hidden sm:table-cell">Links</th>
                <th className="text-right px-5 py-3 font-medium hidden sm:table-cell">Clicks</th>
                <th className="text-right px-5 py-3 font-medium">Bookings</th>
                <th className="text-right px-5 py-3 font-medium">Revenue</th>
                <th className="text-right px-5 py-3 font-medium">Commission</th>
                <th className="w-8 px-5 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {partners.map((a) => (
                <tr key={a.id} className="group hover:bg-zinc-50 transition-colors">
                  <td className="px-5 py-3">
                    <span className="font-medium text-zinc-700">{a.name}</span>
                    {!a.is_active && (
                      <span className="ml-1.5 text-[10px] text-zinc-300 font-medium uppercase">inactive</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-zinc-400 hidden sm:table-cell">{a.email ?? '—'}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-500 hidden sm:table-cell">{a.active_links ?? 0}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-500 hidden sm:table-cell">{(a.total_clicks ?? 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-500">{(a.total_bookings ?? 0).toLocaleString()}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-zinc-500">€{(a.revenue_eur ?? 0).toLocaleString('nl-NL', { minimumFractionDigits: 0 })}</td>
                  <td className="px-5 py-3 text-right tabular-nums font-medium text-emerald-600">€{(a.commission_eur ?? 0).toLocaleString('nl-NL', { minimumFractionDigits: 2 })}</td>
                  <td className="px-5 py-3 text-right">
                    <a href={`partners/${a.id}`} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <ExternalLink className="w-3.5 h-3.5 text-zinc-400" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PartnerModal
        open={showModal}
        onClose={() => setShowModal(false)}
        onSaved={() => refresh()}
      />
    </div>
  )
}
