'use client'

import { useEffect, useState } from 'react'
import { Landmark, Link2, Loader2, RefreshCw, Unplug, Webhook, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { useAdminFetch, adminFetcher } from '@/hooks/useAdminFetch'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import {
  COCKPIT_API,
  type RevolutAccountsResponse,
  type RevolutConnectResponse,
  type RevolutEnvironment,
  type RevolutStatus,
  type RevolutSyncResponse,
  type RevolutWebhookResponse,
} from './api-types'
import { eur, dateTimeNL } from './money'

export const REVOLUT_API = `${COCKPIT_API}/revolut`

interface RevolutConnectCardProps {
  status: RevolutStatus | undefined
  loading: boolean
  /** Called after anything changed at Revolut's side (sync, account, webhook, disconnect). */
  onChanged: () => void
  /** When set, a small × in the corner hides the card again (it was opened from the header). */
  onDismiss?: () => void
}

const cardClass = 'rounded-2xl border border-zinc-200 bg-white shadow-sm'

export function EnvironmentBadge({ environment }: { environment: RevolutEnvironment }) {
  const production = environment === 'production'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
      production ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-200'
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${production ? 'bg-emerald-500' : 'bg-amber-500'}`} />
      {production ? 'Productie' : 'Sandbox'}
    </span>
  )
}

/** Human text for the "Sync now" toast: "3 nieuwe, 1 statuswijziging". */
export function syncSummary(r: RevolutSyncResponse): string {
  const parts: string[] = []
  parts.push(`${r.fetched} ${r.fetched === 1 ? 'transactie' : 'transacties'} opgehaald`)
  if (r.stateChanges.length > 0) parts.push(`${r.stateChanges.length} ${r.stateChanges.length === 1 ? 'statuswijziging' : 'statuswijzigingen'}`)
  if (r.balanceCents != null) parts.push(`saldo ${eur(r.balanceCents)}`)
  return parts.join(' · ')
}

/**
 * "Rekening kiezen" — which Revolut account counts as cash. Only EUR accounts
 * are selectable (the API refuses anything else), the rest are listed greyed
 * so Beer sees they exist.
 */
function AccountPickerModal({ open, selectedAccountId, onClose, onChosen }: {
  open: boolean
  selectedAccountId: string | null
  onClose: () => void
  onChosen: () => void
}) {
  const { data, isLoading, error: loadError } = useAdminFetch<RevolutAccountsResponse>(open ? `${REVOLUT_API}/accounts` : null)
  const { saving, error, setError, run } = useAdminSave()
  const [choice, setChoice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoice(selectedAccountId)
    setError(null)
  }, [open, selectedAccountId, setError])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!choice) { setError('Kies een rekening.'); return }
    run(async () => {
      const res = await adminMutate<{ accountId: string; accountName: string | null; balanceCents: number }>(`${REVOLUT_API}/accounts`, 'PUT', { account_id: choice })
      toast.success(`Rekening gekozen: ${res.accountName ?? res.accountId}`, { description: `Saldo ${eur(res.balanceCents)}` })
      onChosen()
      onClose()
    })
  }

  const accounts = data?.accounts ?? []

  return (
    <AdminFormModal
      open={open}
      title="Rekening kiezen"
      subtitle="Het saldo van deze rekening telt als cash in de berekening."
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error ?? loadError}
      submitLabel="Kiezen"
      submitDisabled={!choice || choice === selectedAccountId}
      maxWidthClass="max-w-md"
    >
      {isLoading && !data ? (
        <p className="text-sm text-zinc-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Rekeningen ophalen bij Revolut…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-zinc-500">Revolut gaf geen rekeningen terug.</p>
      ) : (
        <ul className="rounded-lg border border-zinc-200 divide-y divide-zinc-100">
          {accounts.map(a => {
            const eligible = a.currency === 'EUR' && a.state === 'active'
            const checked = choice === a.id
            return (
              <li key={a.id}>
                <label className={`flex items-center gap-3 px-3 py-2.5 min-h-[44px] ${eligible ? 'cursor-pointer hover:bg-zinc-50' : 'opacity-50 cursor-not-allowed'} ${checked ? 'bg-indigo-50/60' : ''}`}>
                  <input
                    type="radio"
                    name="revolut-account"
                    value={a.id}
                    checked={checked}
                    disabled={!eligible}
                    onChange={() => setChoice(a.id)}
                    className="accent-zinc-900"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-zinc-900 truncate">{a.name ?? 'Naamloze rekening'}</span>
                    <span className="block text-[11px] text-zinc-500 truncate">
                      {a.currency}{a.accountType ? ` · ${a.accountType}` : ''}{a.state !== 'active' ? ` · ${a.state}` : ''}
                      {a.id === selectedAccountId ? ' · huidige keuze' : ''}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-zinc-900 shrink-0">{eur(a.balanceCents)}</span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </AdminFormModal>
  )
}

/** Small key/value line in the connected state. */
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="text-sm text-zinc-900 break-words">{children}</dd>
    </div>
  )
}

/**
 * The Revolut card on the overview: three states (not configured / configured
 * but not connected / connected), each with only the buttons that can work.
 *
 * Connecting is a full-page redirect to Revolut (consent + 2FA), so the card
 * never sees the token — Revolut sends the browser back to the overview with
 * ?revolut=connected, which the page turns into a toast.
 */
export function RevolutConnectCard({ status, loading, onChanged, onDismiss }: RevolutConnectCardProps) {
  const { saving, error, run } = useAdminSave()
  const [busy, setBusy] = useState<'connect' | 'sync' | 'webhook' | 'disconnect' | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  function act(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    setBusy(kind)
    run(action).finally(() => setBusy(null))
  }

  function connect() {
    act('connect', async () => {
      const res = await adminFetcher<RevolutConnectResponse>(`${REVOLUT_API}/connect`)
      window.location.assign(res.authorizeUrl)
    })
  }

  function syncNow() {
    act('sync', async () => {
      const res = await adminMutate<RevolutSyncResponse>(`${REVOLUT_API}/sync`, 'POST', {})
      toast.success('Revolut gesynchroniseerd', { description: syncSummary(res) })
      onChanged()
    })
  }

  function toggleWebhook() {
    if (!status) return
    act('webhook', async () => {
      if (status.webhook) {
        await adminMutate<{ removed: boolean }>(`${REVOLUT_API}/webhook`, 'DELETE')
        toast.success('Webhook uitgezet', { description: 'De sync van elke 15 minuten blijft gewoon draaien.' })
      } else {
        const hook = await adminMutate<RevolutWebhookResponse>(`${REVOLUT_API}/webhook`, 'POST', {})
        toast.success('Webhook aangezet', { description: hook.url })
      }
      onChanged()
    })
  }

  function disconnectRevolut() {
    if (!window.confirm('Revolut ontkoppelen? De tokens en webhook worden vergeten; al gesynchroniseerde transacties blijven bewaard.')) return
    act('disconnect', async () => {
      await adminMutate(`${REVOLUT_API}/disconnect`, 'POST', {})
      toast.success('Revolut ontkoppeld')
      onChanged()
    })
  }

  const dismiss = onDismiss && (
    <button type="button" onClick={onDismiss} aria-label="Sluiten" className="p-2 -m-2 rounded-md text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100">
      <X className="w-4 h-4" />
    </button>
  )

  if (!status) {
    return (
      <section className={`${cardClass} p-4 sm:p-5`}>
        <p className="text-sm text-zinc-500 flex items-center gap-2">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {loading ? 'Revolut-status laden…' : 'Revolut-status kon niet worden geladen.'}
        </p>
      </section>
    )
  }

  const errorBanner = error && (
    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
  )

  // ── State 1: env vars missing ──────────────────────────────────────────────
  if (!status.configured || !status.tokenKeyConfigured) {
    const missing: string[] = []
    if (!status.configured) missing.push('REVOLUT_CLIENT_ID', 'REVOLUT_PRIVATE_KEY', 'NEXT_PUBLIC_SITE_URL (of REVOLUT_REDIRECT_URI)')
    if (!status.tokenKeyConfigured) missing.push('REVOLUT_TOKEN_KEY')
    return (
      <section className={`${cardClass} p-4 sm:p-5 space-y-3 border-dashed`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Landmark className="w-4 h-4 text-zinc-400 shrink-0" />
            <h2 className="text-base font-semibold text-zinc-900">Revolut nog niet geconfigureerd</h2>
            <EnvironmentBadge environment={status.environment} />
          </div>
          {dismiss}
        </div>
        <p className="text-sm text-zinc-600">
          De koppeling kan pas gemaakt worden als deze omgevingsvariabelen zijn gezet (lokaal in <code className="text-xs bg-zinc-100 rounded px-1">.env.local</code>, en in Vercel):
        </p>
        <ul className="text-sm text-zinc-800 space-y-1">
          {missing.map(m => (
            <li key={m} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <code className="text-xs bg-zinc-100 rounded px-1.5 py-0.5">{m}</code>
            </li>
          ))}
        </ul>
        {status.redirectUri && (
          <div className="text-sm text-zinc-600">
            Redirect-URI om in Revolut Business (Settings → APIs → Business API) te plakken:
            <code className="block mt-1 text-xs bg-zinc-100 rounded-lg px-2.5 py-2 break-all select-all">{status.redirectUri}</code>
          </div>
        )}
        <p className="text-xs text-zinc-400">Stappenplan: docs/features/financial-management-module.md → "Revolut connection".</p>
      </section>
    )
  }

  // ── State 2: configured, not connected ────────────────────────────────────
  if (!status.connected) {
    return (
      <section className={`${cardClass} p-4 sm:p-5 space-y-3`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Landmark className="w-4 h-4 text-zinc-400 shrink-0" />
            <h2 className="text-base font-semibold text-zinc-900">Koppel Revolut</h2>
            <EnvironmentBadge environment={status.environment} />
          </div>
          {dismiss}
        </div>
        <p className="text-sm text-zinc-600">
          Dan haalt het overzicht je saldo en transacties elke 15 minuten zelf op, in plaats van een handmatig ingevoerd saldo.
          Je geeft toestemming in Revolut Business (met 2FA) en komt daarna hier terug.
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Meta label="Toegang">{status.scopes.length > 0 ? status.scopes.join(', ') : '—'}</Meta>
          <Meta label="Redirect-URI"><span className="text-xs break-all">{status.redirectUri ?? '—'}</span></Meta>
        </dl>
        {errorBanner}
        <div className="pt-1">
          <Button onClick={connect} disabled={saving} className="min-h-[44px] sm:min-h-0 w-full sm:w-auto">
            {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
            Koppel Revolut
          </Button>
        </div>
      </section>
    )
  }

  // ── State 3: connected ────────────────────────────────────────────────────
  const btn = 'min-h-[44px] sm:min-h-0 w-full sm:w-auto'
  return (
    <section className={`${cardClass} p-4 sm:p-5 space-y-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <Landmark className="w-4 h-4 text-emerald-600 shrink-0" />
          <h2 className="text-base font-semibold text-zinc-900">Revolut gekoppeld</h2>
          <EnvironmentBadge environment={status.environment} />
        </div>
        {dismiss}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Meta label="Rekening">
          {status.accountName ?? <span className="text-amber-700">Nog geen rekening gekozen</span>}
          {status.accountId && <span className="block text-[11px] text-zinc-400 truncate">{status.accountId}</span>}
        </Meta>
        <Meta label="Laatste synchronisatie">
          {dateTimeNL(status.lastSyncAt)}
          {status.lastSyncError && <span className="block text-xs text-red-600 mt-0.5 break-words">{status.lastSyncError}</span>}
        </Meta>
        <Meta label="Laatst bekend saldo">
          {status.latestBalance ? eur(status.latestBalance.cents) : '—'}
          {status.latestBalance && <span className="block text-[11px] text-zinc-400">{dateTimeNL(status.latestBalance.takenAt)}</span>}
        </Meta>
        <Meta label="Webhook">
          {status.webhook ? (
            <>
              <span className="text-emerald-700 font-medium">Aan</span>
              {status.webhook.url && <span className="block text-[11px] text-zinc-400 break-all">{status.webhook.url}</span>}
            </>
          ) : (
            <span className="text-zinc-500">Uit — sync elke 15 min.</span>
          )}
        </Meta>
      </dl>

      {errorBanner}

      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2 pt-1">
        <Button onClick={syncNow} disabled={saving} className={btn}>
          {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Nu synchroniseren
        </Button>
        <Button variant="outline" onClick={() => setPickerOpen(true)} disabled={saving} className={btn}>
          <Landmark className="w-4 h-4" /> Rekening kiezen
        </Button>
        <Button variant="outline" onClick={toggleWebhook} disabled={saving} className={btn}>
          {busy === 'webhook' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Webhook className="w-4 h-4" />}
          {status.webhook ? 'Webhook uitzetten' : 'Webhook aanzetten'}
        </Button>
        <button
          type="button"
          onClick={disconnectRevolut}
          disabled={saving}
          className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 sm:ml-auto px-2 py-1 text-xs text-zinc-400 hover:text-red-600 rounded-md disabled:opacity-50"
        >
          {busy === 'disconnect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
          Ontkoppelen
        </button>
      </div>

      <AccountPickerModal
        open={pickerOpen}
        selectedAccountId={status.accountId}
        onClose={() => setPickerOpen(false)}
        onChosen={onChanged}
      />
    </section>
  )
}

