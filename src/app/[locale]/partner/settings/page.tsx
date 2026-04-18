'use client'

import { useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'

interface NotificationSettings {
  instant_notifications: boolean
  daily_digest: boolean
  weekly_summary: boolean
  monthly_report: boolean
}

const TOGGLE_ROWS: { key: keyof NotificationSettings; label: string; description: string }[] = [
  { key: 'instant_notifications', label: 'Instant notifications', description: 'Get notified for each booking' },
  { key: 'daily_digest', label: 'Daily digest', description: 'A summary of the day\'s activity' },
  { key: 'weekly_summary', label: 'Weekly summary', description: 'Weekly performance overview' },
  { key: 'monthly_report', label: 'Monthly report', description: 'End-of-month commission report' },
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
  const [settings, setSettings] = useState<NotificationSettings>({
    instant_notifications: true,
    daily_digest: false,
    weekly_summary: false,
    monthly_report: false,
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
          setSettings(json.data)
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
        body: JSON.stringify(settings),
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

  function updateSetting(key: keyof NotificationSettings, value: boolean) {
    setSettings(prev => ({ ...prev, [key]: value }))
    setSuccess(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="p-6 sm:p-8 max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-primary)]">Notification Settings</h1>
        <p className="text-sm text-zinc-500 mt-1">Choose which notifications you want to receive.</p>
      </div>

      <div className="bg-white rounded-2xl border border-zinc-200 divide-y divide-zinc-100">
        {TOGGLE_ROWS.map(row => (
          <div
            key={row.key}
            className="flex items-center justify-between px-6 py-4"
          >
            <div>
              <p className="text-sm font-medium text-zinc-900">{row.label}</p>
              <p className="text-xs text-zinc-400 mt-0.5">{row.description}</p>
            </div>
            <Toggle
              checked={settings[row.key]}
              onChange={(v) => updateSetting(row.key, v)}
            />
          </div>
        ))}
      </div>

      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      {success && (
        <p className="text-sm text-green-600">Settings saved</p>
      )}

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
