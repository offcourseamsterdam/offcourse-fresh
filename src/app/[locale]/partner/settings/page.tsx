'use client'

import { useState, useEffect } from 'react'
import { Loader2, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'

interface Settings {
  email: string
  notify_per_booking: boolean
  notify_weekly: boolean
  notify_monthly: boolean
  notify_quarterly: boolean
}

const TOGGLE_ROWS: { key: keyof Omit<Settings, 'email'>; label: string; description: string }[] = [
  { key: 'notify_per_booking', label: 'Instant notifications', description: 'Get notified for each new booking' },
  { key: 'notify_weekly', label: 'Weekly summary', description: 'Weekly performance overview every Monday' },
  { key: 'notify_monthly', label: 'Monthly report', description: 'End-of-month commission report' },
  { key: 'notify_quarterly', label: 'Quarterly report', description: 'Commission summary for invoicing' },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-[var(--color-primary)]' : 'bg-zinc-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

export default function PartnerSettingsPage() {
  const params = useParams()
  const locale = (params?.locale as string) ?? 'en'
  const [settings, setSettings] = useState<Settings>({
    email: '',
    notify_per_booking: true,
    notify_weekly: false,
    notify_monthly: true,
    notify_quarterly: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/partner/settings')
        const json = await res.json()
        if (json.ok) {
          setSettings(prev => ({ ...prev, ...json.data, email: json.data.email ?? '' }))
        } else {
          setError(json.error ?? 'Failed to load settings')
        }
      } catch {
        setError('Network error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSuccess(false)
    try {
      const res = await fetch('/api/partner/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notify_per_booking: settings.notify_per_booking,
          notify_weekly: settings.notify_weekly,
          notify_monthly: settings.notify_monthly,
          notify_quarterly: settings.notify_quarterly,
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 3000)
      } else {
        setError(json.error ?? 'Failed to save settings')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-zinc-400" /></div>
  }

  return (
    <div className="p-6 sm:p-8 max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/${locale}/partner`}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 hover:bg-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-primary)]">Settings</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Notification preferences for your partner account.</p>
        </div>
      </div>

      {/* Notification email */}
      <div className="bg-white rounded-2xl border border-zinc-200 p-6 space-y-2">
        <label className="block text-sm font-medium text-zinc-700">Notification email</label>
        <p className="text-xs text-zinc-400">All notifications are sent to this address.</p>
        <input
          type="email"
          value={settings.email}
          readOnly
          className="w-full px-4 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700 text-sm cursor-default"
        />
        <p className="text-xs text-zinc-400">To change your email address, contact Off Course.</p>
      </div>

      {/* Notification toggles */}
      <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
        {TOGGLE_ROWS.map(row => (
          <div key={row.key} className="flex items-center justify-between px-6 py-4">
            <div>
              <p className="text-sm font-medium text-zinc-900">{row.label}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{row.description}</p>
            </div>
            <Toggle
              checked={settings[row.key]}
              onChange={(v) => setSettings(prev => ({ ...prev, [row.key]: v }))}
            />
          </div>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {success && <p className="text-sm text-green-600">Settings saved</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="px-6 py-2.5 rounded-lg bg-[var(--color-primary)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
      >
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        Save settings
      </button>
    </div>
  )
}
