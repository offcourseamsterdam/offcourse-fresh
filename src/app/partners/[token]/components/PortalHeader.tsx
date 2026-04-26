'use client'

import { useState } from 'react'
import { Copy, Check, AlertTriangle } from 'lucide-react'

interface Props {
  name: string
  portalUrl: string
}

export function PortalHeader({ name, portalUrl }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(portalUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore
    }
  }

  return (
    <header className="space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Partner portal</p>
        <h1 className="text-3xl font-bold mt-1">{name}</h1>
      </div>

      <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div className="space-y-2 flex-1 min-w-0">
          <p className="text-sm font-bold text-red-900">Don&apos;t share this link.</p>
          <p className="text-sm text-red-800 leading-relaxed">
            Anyone with this URL can see your bookings, campaign performance, and settlement amounts.
            Treat it like a password.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <code className="flex-1 truncate text-xs bg-white border border-red-200 rounded-lg px-2 py-1.5 font-mono text-red-900">
              {portalUrl}
            </code>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-white border border-red-200 rounded-lg hover:bg-red-100 text-red-900"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}
