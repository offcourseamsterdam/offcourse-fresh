'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Link2, Loader2, Send, Unlink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { adminInputClass } from '@/components/admin/ui/fields'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { dateNL, dateTimeNL, eur, eurosToCents } from '@/components/admin/finance/cockpit/money'
import { EXPENSE_STATUS_LABELS } from '@/lib/finance/expenses/status'
import type { VatResolution, VatSource } from '@/lib/finance/expenses/vat'
import { ExpenseStatusBadge } from './ExpenseStatusBadge'
import {
  DOCUMENT_KIND_LABELS,
  EXPENSES_API,
  VAT_SOURCE_LABELS,
  type ExpenseActionBody,
  type ExpenseDetailResponse,
  type ExpenseDocumentApiRow,
  type OrphanDocumentsResponse,
} from './api-types'

interface Props {
  expenseId: string | null
  onClose: () => void
  /** Called after any successful action so the list and summary can refresh. */
  onChanged: () => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-zinc-500 shrink-0">{label}</span>
      <span className="text-right text-zinc-900 min-w-0 break-words">{children}</span>
    </div>
  )
}

function extractedOf(doc: ExpenseDocumentApiRow): Record<string, unknown> {
  return (doc.extracted ?? {}) as Record<string, unknown>
}

function DocumentCard({ doc, primary, canUnlink, onUnlink }: { doc: ExpenseDocumentApiRow; primary: boolean; canUnlink: boolean; onUnlink: () => void }) {
  const e = extractedOf(doc)
  const gross = typeof e.grossCents === 'number' ? e.grossCents : null
  const vat = typeof e.vatCents === 'number' ? e.vatCents : null
  return (
    <li className={`rounded-xl border p-3 text-sm ${primary ? 'border-zinc-900' : 'border-zinc-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-zinc-900 truncate">
            {DOCUMENT_KIND_LABELS[doc.kind] ?? doc.kind}
            {primary && <span className="ml-2 text-[10px] uppercase tracking-wide text-zinc-500">primair</span>}
            {doc.duplicate_of && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">duplicaat</span>}
          </p>
          <p className="text-xs text-zinc-500 truncate">{doc.original_filename ?? doc.link_url ?? dateTimeNL(doc.created_at)}</p>
          {Boolean(gross != null || vat != null || e.invoiceNumber || e.orderNumber) && (
            <p className="text-xs text-zinc-500 mt-1">
              {[e.invoiceNumber ? `nr ${String(e.invoiceNumber)}` : null, e.orderNumber ? `order ${String(e.orderNumber)}` : null, gross != null ? `bruto ${eur(gross)}` : null, vat != null ? `btw ${eur(vat)}` : null].filter(Boolean).join(' · ')}
            </p>
          )}
          {doc.kind === 'invoice_link' && doc.link_fetch_status !== 'fetched' && (
            <p className="text-xs text-amber-700 mt-1">Link niet automatisch opgehaald ({doc.link_fetch_status}). Download handmatig en upload via e-mail naar het factuuradres.</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {doc.file_path && (
            <a
              href={`/api/admin/finance/attachments/expense_document/${doc.id}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg text-zinc-500 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900"
              aria-label="Document openen"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          )}
          {canUnlink && (
            <button type="button" onClick={onUnlink} className="inline-flex items-center justify-center w-11 h-11 sm:w-9 sm:h-9 rounded-lg text-zinc-500 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900" aria-label="Ontkoppelen">
              <Unlink className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * Right-hand panel (full-screen sheet on mobile) for one Expense Record: the
 * payment, the documents, the VAT with its provenance, and every action Beer
 * has. Actions POST to /actions and hand the refreshed detail back.
 */
export function ExpenseDrawer({ expenseId, onClose, onChanged }: Props) {
  const open = expenseId != null
  const { data, isLoading, error, mutate } = useAdminFetch<ExpenseDetailResponse>(open ? `${EXPENSES_API}/${expenseId}` : null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [showLink, setShowLink] = useState(false)
  const [vatInput, setVatInput] = useState('')
  const [ignoreNote, setIgnoreNote] = useState('')
  const [showIgnore, setShowIgnore] = useState(false)
  const { data: orphans } = useAdminFetch<OrphanDocumentsResponse>(open && showLink ? `${EXPENSES_API}/documents/orphans` : null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const asideRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setActionError(null)
    setShowLink(false)
    setShowIgnore(false)
    setVatInput('')
    setIgnoreNote('')
  }, [expenseId])

  // Dialog behaviour: focus moves in on open and back out on close, Tab stays inside, Escape closes, the page behind doesn't scroll.
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (e.key !== 'Tab' || !asideRef.current) return
      const focusable = Array.from(asideRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'))
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previous?.focus?.()
    }
  }, [open, onClose])

  async function act(body: ExpenseActionBody) {
    if (!expenseId) return
    setBusy(body.action)
    setActionError(null)
    try {
      const fresh = await adminMutate<ExpenseDetailResponse>(`${EXPENSES_API}/${expenseId}/actions`, 'POST', body)
      mutate(() => fresh, { revalidate: false })
      onChanged()
      setShowLink(false)
      setShowIgnore(false)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Actie mislukt.')
    } finally {
      setBusy(null)
    }
  }

  if (!open) return null
  const x = data?.expense
  const docs = data?.documents ?? []
  // resolveVat() stores the losing candidates as { source: cents }.
  const vatConflict = (x?.vat_conflict ?? null) as VatResolution['conflict']
  const editable = !!x && !x.booked_at
  // Same rule as forwardExpenseToSnelstart for a manual actor: matched or ready, no conflict, not yet sent.
  const canForward = !!x && !x.snelstart_sent_at && !!x.primary_document_id && (x.status === 'matched' || x.status === 'ready_for_snelstart') && x.vat_conflict == null
  const needsConfirm = !!x && x.status === 'matched' && data?.provenanceTrusted === false

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <aside ref={asideRef} role="dialog" aria-modal="true" aria-labelledby="expense-drawer-title" className="absolute inset-y-0 right-0 w-full sm:max-w-lg bg-white shadow-xl flex flex-col">
        <header className="flex items-start justify-between gap-3 p-4 border-b border-zinc-100">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-zinc-400 tabular-nums">{x?.ref ?? '…'}</p>
            <h2 id="expense-drawer-title" className="text-lg font-semibold text-zinc-900 break-words">{x?.supplier_name ?? (isLoading ? 'Laden…' : 'Onbekende leverancier')}</h2>
            {x && <div className="mt-1 flex items-center gap-2 flex-wrap"><ExpenseStatusBadge status={x.status} />{x.needs_review_reason && <span className="text-xs text-red-700">{x.needs_review_reason}</span>}</div>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-zinc-500 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900" aria-label="Sluiten">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <AdminErrorBanner error={error ?? actionError} />
          {isLoading && !data && <p className="text-sm text-zinc-500">Laden…</p>}

          {x && (
            <>
              <section className="rounded-xl border border-zinc-200 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Betaling</h3>
                {x.bank_transaction_id ? (
                  <>
                    <Row label="Afgeschreven">{x.cash_out_cents != null ? eur(x.cash_out_cents) : '—'}</Row>
                    <Row label="Datum">{dateNL(x.paid_at)}</Row>
                    {x.revolut_expense_state && <Row label="Revolut-status">{x.revolut_expense_state}</Row>}
                  </>
                ) : (
                  <p className="text-sm text-zinc-500">Nog geen betaling gezien — het document wacht tot de kaartbetaling of overboeking binnenkomt.</p>
                )}
              </section>

              <section className="rounded-xl border border-zinc-200 p-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">Factuur / bon</h3>
                <Row label="Bruto">{x.gross_cents != null ? eur(x.gross_cents) : '—'}</Row>
                <Row label="BTW">
                  {x.vat_cents != null ? eur(x.vat_cents) : '—'}
                  {x.vat_rate_pct != null && <span className="text-zinc-500"> · {Number(x.vat_rate_pct)}%</span>}
                  {x.vat_source && <span className="text-zinc-400"> · bron: {VAT_SOURCE_LABELS[x.vat_source as VatSource] ?? x.vat_source}</span>}
                </Row>
                <Row label="Netto">{x.net_cents != null ? eur(x.net_cents) : '—'}</Row>
                {x.invoice_number && <Row label="Factuurnummer">{x.invoice_number}</Row>}
                {x.order_number && <Row label="Ordernummer">{x.order_number}</Row>}
                {x.invoice_date && <Row label="Factuurdatum">{dateNL(x.invoice_date)}</Row>}
                {vatConflict && (
                  <div className="mt-2 rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-800 flex gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      BTW-bronnen spreken elkaar tegen: {Object.entries(vatConflict).map(([source, cents]) => `${VAT_SOURCE_LABELS[source as VatSource] ?? source} ${eur(cents as number)}`).join(' vs ')}. Vul hieronder het juiste bedrag in.
                    </span>
                  </div>
                )}
                {editable && (
                  <form
                    className="mt-3 flex items-end gap-2"
                    onSubmit={e => {
                      e.preventDefault()
                      const cents = eurosToCents(vatInput)
                      if (cents == null) { setActionError('Vul een BTW-bedrag in euro\'s in.'); return }
                      void act({ action: 'vat', vatCents: cents })
                    }}
                  >
                    <label className="block flex-1">
                      <span className="block text-xs font-medium text-zinc-600 mb-1">BTW handmatig (€)</span>
                      <input inputMode="decimal" value={vatInput} onChange={e => setVatInput(e.target.value)} placeholder={x.vat_cents != null ? (x.vat_cents / 100).toFixed(2).replace('.', ',') : '0,00'} className={`${adminInputClass} min-h-[44px] sm:min-h-0`} />
                    </label>
                    <Button type="submit" variant="outline" size="sm" disabled={busy != null || !vatInput.trim()} className="min-h-[44px] sm:min-h-0">
                      {busy === 'vat' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Opslaan
                    </Button>
                  </form>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Documenten ({docs.length})</h3>
                  {editable && (
                    <Button variant="outline" size="sm" onClick={() => setShowLink(v => !v)} className="min-h-[44px] sm:min-h-0">
                      <Link2 className="w-3.5 h-3.5" /> Document koppelen
                    </Button>
                  )}
                </div>
                {docs.length === 0 && <p className="text-sm text-zinc-500">Nog geen document. Zodra een factuur of bon binnenkomt (mail, Revolut-bon) verschijnt die hier — of koppel er zelf een.</p>}
                <ul className="space-y-2">
                  {docs.map(d => (
                    <DocumentCard key={d.id} doc={d} primary={d.id === x.primary_document_id} canUnlink={editable && d.id !== x.snelstart_document_id} onUnlink={() => void act({ action: 'unlink', documentId: d.id })} />
                  ))}
                </ul>
                {showLink && (
                  <div className="mt-3 rounded-xl border border-dashed border-zinc-300 p-3">
                    <p className="text-xs text-zinc-500 mb-2">Nog niet gekoppelde documenten, nieuwste eerst:</p>
                    {!orphans ? (
                      <p className="text-sm text-zinc-400">Laden…</p>
                    ) : orphans.documents.length === 0 ? (
                      <p className="text-sm text-zinc-500">Geen losse documenten. Stuur de factuur naar het factuuradres, dan verschijnt hij hier.</p>
                    ) : (
                      <ul className="divide-y divide-zinc-100 max-h-64 overflow-y-auto">
                        {orphans.documents.map(d => {
                          const e = extractedOf(d)
                          return (
                            <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                              <span className="min-w-0">
                                <span className="block truncate text-zinc-900">{String(e.supplierName ?? d.original_filename ?? DOCUMENT_KIND_LABELS[d.kind])}</span>
                                <span className="block text-xs text-zinc-500 truncate">
                                  {DOCUMENT_KIND_LABELS[d.kind]}{typeof e.grossCents === 'number' ? ` · ${eur(e.grossCents)}` : ''}{e.invoiceDate ? ` · ${dateNL(String(e.invoiceDate))}` : ` · ${dateNL(d.created_at)}`}
                                </span>
                              </span>
                              <Button size="sm" variant="outline" disabled={busy != null} onClick={() => void act({ action: 'link', documentId: d.id })} className="min-h-[44px] sm:min-h-0 shrink-0">
                                Koppel
                              </Button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-zinc-200 p-3 text-sm space-y-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-1">SnelStart</h3>
                {needsConfirm && (
                  <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs mb-2">
                    Dit document kwam per mail van een afzender die we niet kennen en niets anders bevestigt het. Het gaat pas automatisch naar SnelStart na "Koppeling bevestigen" — of stuur het nu zelf door.
                  </p>
                )}
                {x.snelstart_sent_at ? (
                  <>
                    <Row label="Doorgestuurd">{dateTimeNL(x.snelstart_sent_at)}</Row>
                    <Row label="Naar">{x.snelstart_recipient ?? '—'}</Row>
                    {x.booked_at && <Row label="Geboekt">{dateTimeNL(x.booked_at)}</Row>}
                  </>
                ) : (
                  <p className="text-zinc-500">
                    {x.status === 'ready_for_snelstart' ? 'Klaar — gaat bij de volgende uurlijkse ronde automatisch, of nu handmatig.' : `Status is "${EXPENSE_STATUS_LABELS[x.status as keyof typeof EXPENSE_STATUS_LABELS] ?? x.status}"; automatisch doorsturen gebeurt alleen bij "Klaar voor SnelStart".`}
                  </p>
                )}
              </section>

              {x.notes && <p className="text-xs text-zinc-500 whitespace-pre-wrap">Notitie: {x.notes}</p>}
            </>
          )}
        </div>

        {x && (
          <footer className="border-t border-zinc-100 p-3 flex flex-wrap gap-2">
            {(x.status === 'partially_matched' || needsConfirm) && x.primary_document_id && (
              <Button size="sm" onClick={() => void act({ action: 'confirm' })} disabled={busy != null} className="min-h-[44px] sm:min-h-0">
                {busy === 'confirm' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Koppeling bevestigen
              </Button>
            )}
            {x.needs_review_reason && (
              <Button size="sm" variant="outline" onClick={() => void act({ action: 'clear_review' })} disabled={busy != null} className="min-h-[44px] sm:min-h-0">
                Gecontroleerd
              </Button>
            )}
            {canForward && (
              <Button size="sm" variant={x.status === 'ready_for_snelstart' ? 'default' : 'outline'} onClick={() => void act({ action: 'forward' })} disabled={busy != null} className="min-h-[44px] sm:min-h-0">
                {busy === 'forward' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Naar SnelStart
              </Button>
            )}
            {x.snelstart_sent_at && !x.booked_at && (
              <Button size="sm" variant="outline" onClick={() => void act({ action: 'booked' })} disabled={busy != null} className="min-h-[44px] sm:min-h-0">
                Geboekt
              </Button>
            )}
            {editable && !x.snelstart_sent_at && x.status !== 'ignored' && (
              showIgnore ? (
                <form className="flex items-end gap-2 w-full" onSubmit={e => { e.preventDefault(); void act({ action: 'ignore', note: ignoreNote.trim() || null }) }}>
                  <label className="block flex-1">
                    <span className="block text-xs font-medium text-zinc-600 mb-1">Reden (optioneel)</span>
                    <input value={ignoreNote} onChange={e => setIgnoreNote(e.target.value)} placeholder="bijv. privé, terugbetaling" className={`${adminInputClass} min-h-[44px] sm:min-h-0`} />
                  </label>
                  <Button type="submit" size="sm" variant="outline" disabled={busy != null} className="min-h-[44px] sm:min-h-0">Negeren</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowIgnore(false)} className="min-h-[44px] sm:min-h-0">Annuleer</Button>
                </form>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setShowIgnore(true)} disabled={busy != null} className="min-h-[44px] sm:min-h-0 text-zinc-500">
                  Negeren
                </Button>
              )
            )}
            {x.status === 'ignored' && (
              <Button size="sm" variant="outline" onClick={() => void act({ action: 'unignore' })} disabled={busy != null} className="min-h-[44px] sm:min-h-0">
                Toch verwerken
              </Button>
            )}
          </footer>
        )}
      </aside>
    </div>
  )
}
