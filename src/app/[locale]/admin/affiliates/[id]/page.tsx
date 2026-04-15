'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import { Loader2, ArrowLeft, Copy, Check } from 'lucide-react'
import { KPICard } from '@/components/admin/tracking/KPICard'

interface Partner {
  id: string
  name: string
  email: string | null
  contact_name: string | null
  phone: string | null
  website: string | null
  notes: string | null
  is_active: boolean
}

interface TrackingLink {
  id: string
  name: string
  slug: string
  destination_url: string
  commission_type: string
  commission_percentage: number | null
  fixed_commission_amount: number | null
  is_active: boolean | null
}

interface NotificationSettings {
  notify_per_booking: boolean
  notify_weekly: boolean
  notify_monthly: boolean
  notify_quarterly: boolean
  email_recipients: string[]
}

export default function AffiliateDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [partner, setPartner] = useState<Partner | null>(null)
  const [links, setLinks] = useState<TrackingLink[]>([])
  const [notifications, setNotifications] = useState<NotificationSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [partnerRes, notifRes] = await Promise.all([
        fetch(`/api/admin/tracking/affiliates/${id}`),
        fetch(`/api/admin/tracking/notifications?partner_id=${id}`),
      ])
      const [partnerJson, notifJson] = await Promise.all([
        partnerRes.json(),
        notifRes.json(),
      ])
      if (partnerJson.ok) setPartner(partnerJson.data)
      if (notifJson.ok && notifJson.data) setNotifications(notifJson.data)
    } catch (err) {
      console.error('Failed to load partner:', err)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchData() }, [fetchData])

  function copyLink(slug: string) {
    const url = `${window.location.origin}/api/t/${slug}`
    navigator.clipboard.writeText(url)
    setCopied(slug)
    setTimeout(() => setCopied(null), 2000)
  }

  async function saveNotifications(updates: Partial<NotificationSettings>) {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/tracking/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_id: id, ...notifications, ...updates }),
      })
      const json = await res.json()
      if (json.ok) setNotifications(json.data)
    } catch (err) {
      console.error('Failed to save notifications:', err)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (!partner) {
    return <div className="p-8 text-sm text-zinc-400">Partner not found</div>
  }

  return (
    <div className="p-6 sm:p-8 max-w-5xl space-y-6">
      {/* Breadcrumb */}
      <a href="../affiliates" className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600">
        <ArrowLeft className="w-3 h-3" /> Back to Affiliates
      </a>

      {/* Partner info */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5">
        <h1 className="text-xl font-bold text-zinc-900 mb-1">{partner.name}</h1>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-zinc-400">
          {partner.email && <span>{partner.email}</span>}
          {partner.contact_name && <span>Contact: {partner.contact_name}</span>}
          {partner.phone && <span>{partner.phone}</span>}
          {partner.website && <span>{partner.website}</span>}
        </div>
        {partner.notes && <p className="text-xs text-zinc-500 mt-2">{partner.notes}</p>}
      </div>

      {/* Notification settings */}
      <div className="bg-white rounded-xl border border-zinc-200 p-5">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">Email Notifications</h2>
        <div className="flex flex-wrap gap-4">
          {(['notify_per_booking', 'notify_weekly', 'notify_monthly', 'notify_quarterly'] as const).map((key) => {
            const labels: Record<string, string> = {
              notify_per_booking: 'Per booking',
              notify_weekly: 'Weekly summary',
              notify_monthly: 'Monthly summary',
              notify_quarterly: 'Quarterly invoice',
            }
            const isChecked = notifications?.[key] ?? false
            return (
              <label key={key} className="flex items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => saveNotifications({ [key]: e.target.checked })}
                  disabled={saving}
                  className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                />
                {labels[key]}
              </label>
            )
          })}
        </div>
      </div>

      {/* Tracking links */}
      {links.length > 0 && (
        <div className="bg-white rounded-xl border border-zinc-200 p-5">
          <h2 className="text-sm font-semibold text-zinc-900 mb-3">Tracking Links</h2>
          <div className="space-y-2">
            {links.map((link) => (
              <div key={link.id} className="flex items-center gap-3 py-2 border-b border-zinc-50 last:border-0">
                <span className="text-xs font-medium text-zinc-700 flex-1">{link.name}</span>
                <code className="text-[10px] text-zinc-400 bg-zinc-50 px-2 py-1 rounded">/api/t/{link.slug}</code>
                <button onClick={() => copyLink(link.slug)} className="text-zinc-400 hover:text-zinc-600">
                  {copied === link.slug ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
