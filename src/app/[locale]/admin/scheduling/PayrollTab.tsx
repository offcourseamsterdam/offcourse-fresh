'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2, AlertTriangle, Plus, Trash2, Check, X, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { fmtEuros, formatAmsterdamTime, amsterdamToday } from '@/lib/utils'
import {
  aggregatePayroll,
  formatMinutes,
  entryMinutes,
  entryPayCents,
  type PayrollTimeEntry,
} from '@/lib/scheduling/payroll'

interface PayrollEntry extends PayrollTimeEntry {
  source: string
  note: string | null
}
interface PayrollBonus {
  id: string
  staff_id: string
  amount_cents: number
  awarded_at: string
  social_proof_reviews: { rating: number } | null
}
/** An on-the-water upsell commission (Beer, 2026-08-24: 50% of what was charged). */
interface PayrollExtraHoursBonus {
  id: string
  staff_id: string
  date: string
  extra_minutes: number
  amount_charged_cents: number
  commission_cents: number
  note: string | null
}
interface PayrollPayload {
  entries: PayrollEntry[]
  staff: { id: string; name: string; role: string }[]
  bonuses: PayrollBonus[]
  extraHoursBonuses: PayrollExtraHoursBonus[]
  from: string
  to: string
}

/** A captain's Slack DM about an on-the-water upsell, read and drafted by
 *  upsell-bonus-drafter.ts — awaiting a human's review (Beer, 2026-08-24). */
interface UpsellProposalPayload {
  staff_id: string | null
  staff_name: string | null
  date: string
  extra_minutes: number
  amount_charged_cents: number
  raw_message: string
}
interface PendingUpsellProposal {
  id: string
  payload: UpsellProposalPayload
  reasoning: string | null
  created_at: string
}

/** One row in the combined ledger below — a review mention or a confirmed upsell. */
interface BonusRow {
  key: string
  kind: 'review' | 'upsell'
  id: string | null // upsell rows only, for delete
  staffId: string
  date: string
  detail: string
  amountCents: number
}

const FLAG_LABEL: Record<string, string> = {
  auto_closed: 'Auto-closed',
  manual_edit: 'Manual edit',
  overlong: 'Overlong',
  no_shift: 'No shift',
}

/** Live 50%-commission preview as the admin edits the "Charged (€)" field. */
function commissionPreviewCents(amountChargedEuros: string): number {
  const cents = Math.round(Number(amountChargedEuros) * 100)
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents * 0.5) : 0
}

function monthRange(d: Date): { from: string; to: string; label: string } {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return {
    from: iso(first),
    to: iso(last),
    label: first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
  }
}

export function PayrollTab() {
  const [cursor, setCursor] = useState(() => new Date())
  const { from, to, label } = useMemo(() => monthRange(cursor), [cursor])

  const { data, isLoading, error, refresh } = useAdminFetch<PayrollPayload>(
    `/api/admin/scheduling/payroll?from=${from}&to=${to}`,
  )

  // The "upsell review environment" queue — not scoped to the month filter
  // above, since an unconfirmed proposal doesn't have a settled date yet.
  const { data: upsellQueue, refresh: refreshUpsellQueue } = useAdminFetch<{ proposals: PendingUpsellProposal[] }>(
    '/api/admin/scheduling/upsell-proposals',
  )

  // Combined ledger: every review-bonus mention + every confirmed upsell,
  // newest first (Beer, 2026-08-24: "a table with bonuses (including
  // reviews) and cruise time upsells").
  const bonusRows = useMemo((): BonusRow[] => {
    const reviews: BonusRow[] = (data?.bonuses ?? []).map(b => ({
      key: `review-${b.id}`,
      kind: 'review',
      id: null,
      staffId: b.staff_id,
      date: b.awarded_at.slice(0, 10),
      detail: b.social_proof_reviews?.rating ? `${'★'.repeat(b.social_proof_reviews.rating)} review mention` : 'review mention',
      amountCents: b.amount_cents,
    }))
    const upsells: BonusRow[] = (data?.extraHoursBonuses ?? []).map(x => ({
      key: `upsell-${x.id}`,
      kind: 'upsell',
      id: x.id,
      staffId: x.staff_id,
      date: x.date,
      detail: `+${x.extra_minutes} min, charged ${fmtEuros(x.amount_charged_cents)}${x.note ? ` — ${x.note}` : ''}`,
      amountCents: x.commission_cents,
    }))
    return [...reviews, ...upsells].sort((a, b) => b.date.localeCompare(a.date))
  }, [data])

  const lines = useMemo(
    () => (data ? aggregatePayroll(data.entries, data.staff) : []),
    [data],
  )

  // Aggregate review bonuses per staff for the selected period.
  const bonusByStaff = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of data?.bonuses ?? []) {
      map.set(b.staff_id, (map.get(b.staff_id) ?? 0) + b.amount_cents)
    }
    return map
  }, [data])

  // Aggregate on-the-water upsell commission per staff (Beer, 2026-08-24).
  const extraHoursByStaff = useMemo(() => {
    const map = new Map<string, number>()
    for (const x of data?.extraHoursBonuses ?? []) {
      map.set(x.staff_id, (map.get(x.staff_id) ?? 0) + x.commission_cents)
    }
    return map
  }, [data])

  const totals = useMemo(
    () =>
      lines.reduce(
        (acc, l) => ({
          minutes: acc.minutes + l.totalMinutes,
          pay: acc.pay + l.totalPayCents,
          bonus: acc.bonus + (bonusByStaff.get(l.staffId) ?? 0),
          extraHours: acc.extraHours + (extraHoursByStaff.get(l.staffId) ?? 0),
          open: acc.open + l.openCount,
          flagged: acc.flagged + l.flaggedCount,
        }),
        { minutes: 0, pay: 0, bonus: 0, extraHours: 0, open: 0, flagged: 0 },
      ),
    [lines, bonusByStaff, extraHoursByStaff],
  )

  const flaggedEntries = useMemo(
    () => (data?.entries ?? []).filter(e => e.flag || !e.clock_out_at),
    [data],
  )

  // Log-an-upsell form (Beer, 2026-08-24: "a captain upsells an extra hour
  // or 30 minutes... 50% commission"). A plain refetch after write is fine
  // here — this is a low-frequency admin action, not worth optimistic UI.
  const [newUpsell, setNewUpsell] = useState({ staffId: '', date: amsterdamToday(), extraMinutes: '30', amountCharged: '', note: '' })
  const [upsellError, setUpsellError] = useState<string | null>(null)
  const [savingUpsell, setSavingUpsell] = useState(false)

  async function logUpsell() {
    const cents = Math.round(Number(newUpsell.amountCharged) * 100)
    if (!newUpsell.staffId || !newUpsell.extraMinutes || !cents || cents <= 0) {
      setUpsellError('Pick a captain and enter the extra minutes and amount charged.')
      return
    }
    setUpsellError(null)
    setSavingUpsell(true)
    try {
      await adminMutate('/api/admin/scheduling/extra-hours-bonus', 'POST', {
        staff_id: newUpsell.staffId,
        date: newUpsell.date,
        extra_minutes: Number(newUpsell.extraMinutes),
        amount_charged_cents: cents,
        note: newUpsell.note || undefined,
      })
      setNewUpsell({ staffId: '', date: amsterdamToday(), extraMinutes: '30', amountCharged: '', note: '' })
      refresh()
    } catch (err) {
      setUpsellError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSavingUpsell(false)
    }
  }

  async function deleteUpsell(id: string) {
    try {
      await adminMutate(`/api/admin/scheduling/extra-hours-bonus?id=${id}`, 'DELETE')
      refresh()
    } catch (err) {
      setUpsellError(err instanceof Error ? err.message : 'Could not delete')
    }
  }

  // The "upsell review environment" (Beer, 2026-08-24): each pending
  // proposal is editable before confirming — the AI's captain match is
  // often null (real captains mostly have no slack_member_id on file yet),
  // and any field can be off, so a human corrects it right here rather than
  // trusting the draft blindly.
  type UpsellDraft = { staffId: string; date: string; extraMinutes: string; amountCharged: string }
  const [upsellDrafts, setUpsellDrafts] = useState<Record<string, UpsellDraft>>({})
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [workingId, setWorkingId] = useState<string | null>(null)

  function draftFor(p: PendingUpsellProposal): UpsellDraft {
    return (
      upsellDrafts[p.id] ?? {
        staffId: p.payload.staff_id ?? '',
        date: p.payload.date,
        extraMinutes: String(p.payload.extra_minutes),
        amountCharged: (p.payload.amount_charged_cents / 100).toFixed(2),
      }
    )
  }

  async function confirmUpsellProposal(p: PendingUpsellProposal) {
    const draft = draftFor(p)
    const cents = Math.round(Number(draft.amountCharged) * 100)
    if (!draft.staffId || !draft.date || !draft.extraMinutes || !cents || cents <= 0) {
      setReviewError('Pick a captain and check the extra minutes and amount charged.')
      return
    }
    setReviewError(null)
    setWorkingId(p.id)
    try {
      await adminMutate(`/api/admin/ghost/proposals/${p.id}`, 'POST', {
        action: 'confirm_upsell_bonus',
        staff_id: draft.staffId,
        date: draft.date,
        extra_minutes: Number(draft.extraMinutes),
        amount_charged_cents: cents,
      })
      setUpsellDrafts(d => { const next = { ...d }; delete next[p.id]; return next })
      refreshUpsellQueue()
      refresh() // the new bonus now shows in the ledger + totals below
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Could not confirm')
    } finally {
      setWorkingId(null)
    }
  }

  async function rejectUpsellProposal(id: string) {
    setWorkingId(id)
    try {
      await adminMutate(`/api/admin/ghost/proposals/${id}`, 'POST', { action: 'reject_upsell_bonus' })
      setUpsellDrafts(d => { const next = { ...d }; delete next[id]; return next })
      refreshUpsellQueue()
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : 'Could not dismiss')
    } finally {
      setWorkingId(null)
    }
  }

  function shiftMonth(delta: number) {
    setCursor(c => new Date(c.getFullYear(), c.getMonth() + delta, 1))
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>
            This month
          </Button>
          <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="ml-2 text-sm font-medium text-zinc-700">{label}</span>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-400 ml-1" />}
        </div>

        <a href={`/api/admin/scheduling/payroll/csv?from=${from}&to=${to}`} download>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-1.5" /> Export CSV
          </Button>
        </a>
      </div>

      {error && <AdminErrorBanner error={error} />}

      {/* Upsell review environment (Beer, 2026-08-24: "captains message the
          slack bot; upsell of their cruise with x and then in the payroll
          tab we have an upsell review environment where we can check that
          upsell and assign it properly"). Not month-scoped — a queue, not a
          ledger — so it stays visible regardless of which month is showing. */}
      {(upsellQueue?.proposals.length ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-amber-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-100 bg-amber-50/60">
            <MessageCircle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-zinc-700">Upsells to review</h3>
            <span className="text-xs text-zinc-400">({upsellQueue!.proposals.length}) from Slack DMs — check the captain and figures before confirming</span>
          </div>
          {reviewError && <p className="px-4 py-2 text-xs text-red-600">{reviewError}</p>}
          <div className="divide-y divide-zinc-100">
            {upsellQueue!.proposals.map(p => {
              const draft = draftFor(p)
              const commissionPreview = commissionPreviewCents(draft.amountCharged)
              return (
                <div key={p.id} className="p-4 space-y-3">
                  <p className="text-xs text-zinc-500 italic">&ldquo;{p.payload.raw_message}&rdquo;</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-xs text-zinc-500">
                      Captain
                      <select
                        value={draft.staffId}
                        onChange={e => setUpsellDrafts(d => ({ ...d, [p.id]: { ...draft, staffId: e.target.value } }))}
                        className={`mt-1 block w-40 rounded-lg border px-2 py-1.5 text-sm ${draft.staffId ? 'border-zinc-300' : 'border-red-300'}`}
                      >
                        <option value="">
                          {p.payload.staff_name ? `Select… (AI guessed ${p.payload.staff_name}, unmatched)` : 'Select…'}
                        </option>
                        {(data?.staff ?? []).map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-zinc-500">
                      Date
                      <input
                        type="date"
                        value={draft.date}
                        onChange={e => setUpsellDrafts(d => ({ ...d, [p.id]: { ...draft, date: e.target.value } }))}
                        className="mt-1 block w-36 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      Extra minutes
                      <input
                        type="number"
                        min={1}
                        value={draft.extraMinutes}
                        onChange={e => setUpsellDrafts(d => ({ ...d, [p.id]: { ...draft, extraMinutes: e.target.value } }))}
                        className="mt-1 block w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="text-xs text-zinc-500">
                      Charged (€)
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={draft.amountCharged}
                        onChange={e => setUpsellDrafts(d => ({ ...d, [p.id]: { ...draft, amountCharged: e.target.value } }))}
                        className="mt-1 block w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <span className="text-xs text-zinc-400 pb-1.5">= {fmtEuros(commissionPreview)} commission (50%)</span>
                    <div className="flex-1" />
                    <Button size="sm" onClick={() => confirmUpsellProposal(p)} disabled={workingId === p.id}>
                      <Check className="w-4 h-4 mr-1" /> Confirm
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => rejectUpsellProposal(p.id)} disabled={workingId === p.id}>
                      <X className="w-4 h-4 mr-1" /> Dismiss
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Summary table */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-400 uppercase">
              <th className="px-4 py-3">Staff</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3 text-right">Shifts</th>
              <th className="px-4 py-3 text-right">Hours</th>
              <th className="px-4 py-3 text-right">Pay</th>
              <th className="px-4 py-3 text-right">Bonus</th>
              <th className="px-4 py-3 text-right">Extra hrs</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Review</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && !isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-zinc-400">
                  No hours logged this month.
                </td>
              </tr>
            )}
            {lines.map(l => {
              const bonus = bonusByStaff.get(l.staffId) ?? 0
              const extraHours = extraHoursByStaff.get(l.staffId) ?? 0
              return (
                <tr key={l.staffId} className="border-b border-zinc-50 hover:bg-zinc-50">
                  <td className="px-4 py-3 font-medium text-zinc-900">{l.name}</td>
                  <td className="px-4 py-3 text-zinc-500 capitalize">{l.role}</td>
                  <td className="px-4 py-3 text-right text-zinc-700">{l.entryCount}</td>
                  <td className="px-4 py-3 text-right text-zinc-700">{formatMinutes(l.totalMinutes)}</td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900">{fmtEuros(l.totalPayCents)}</td>
                  <td className="px-4 py-3 text-right">
                    {bonus > 0 ? (
                      <span className="text-xs font-medium text-amber-700">+{fmtEuros(bonus)}</span>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {extraHours > 0 ? (
                      <span className="text-xs font-medium text-emerald-700">+{fmtEuros(extraHours)}</span>
                    ) : (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-900">
                    {fmtEuros(l.totalPayCents + bonus + extraHours)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {l.openCount > 0 && (
                      <span className="inline-block text-xs text-amber-700">{l.openCount} open</span>
                    )}
                    {l.flaggedCount > 0 && (
                      <span className="inline-block text-xs text-red-600 ml-2">{l.flaggedCount} flagged</span>
                    )}
                    {l.openCount === 0 && l.flaggedCount === 0 && (
                      <span className="text-xs text-zinc-300">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {lines.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-zinc-200 font-semibold text-zinc-900">
                <td className="px-4 py-3" colSpan={3}>Total</td>
                <td className="px-4 py-3 text-right">{formatMinutes(totals.minutes)}</td>
                <td className="px-4 py-3 text-right">{fmtEuros(totals.pay)}</td>
                <td className="px-4 py-3 text-right text-amber-700">
                  {totals.bonus > 0 ? `+${fmtEuros(totals.bonus)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right text-emerald-700">
                  {totals.extraHours > 0 ? `+${fmtEuros(totals.extraHours)}` : '—'}
                </td>
                <td className="px-4 py-3 text-right">{fmtEuros(totals.pay + totals.bonus + totals.extraHours)}</td>
                <td className="px-4 py-3" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Bonuses ledger (Beer, 2026-08-24: "a table with bonuses (including
          reviews) and cruise time upsells") + the manual upsell-logging form
          — still there for an upsell that never came in via Slack. */}
      <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
          <h3 className="text-sm font-semibold text-zinc-700">Bonuses</h3>
          <span className="text-xs text-zinc-400">Review mentions (€5 each) + confirmed upsells (50% commission)</span>
        </div>
        <div className="px-4 pt-3 text-xs font-medium text-zinc-500 bg-zinc-50/60">Log an upsell manually — for one that never came in via Slack</div>
        <div className="p-4 flex flex-wrap items-end gap-2 border-b border-zinc-100 bg-zinc-50/60">
          <label className="text-xs text-zinc-500">
            Captain
            <select
              value={newUpsell.staffId}
              onChange={e => setNewUpsell(u => ({ ...u, staffId: e.target.value }))}
              className="mt-1 block w-40 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            >
              <option value="">Select…</option>
              {(data?.staff ?? []).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-500">
            Date
            <input
              type="date"
              value={newUpsell.date}
              onChange={e => setNewUpsell(u => ({ ...u, date: e.target.value }))}
              className="mt-1 block w-36 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Extra minutes
            <input
              type="number"
              min={1}
              value={newUpsell.extraMinutes}
              onChange={e => setNewUpsell(u => ({ ...u, extraMinutes: e.target.value }))}
              className="mt-1 block w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-zinc-500">
            Charged (€)
            <input
              type="number"
              min={0}
              step="0.01"
              value={newUpsell.amountCharged}
              onChange={e => setNewUpsell(u => ({ ...u, amountCharged: e.target.value }))}
              className="mt-1 block w-24 rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-zinc-500 flex-1 min-w-[10rem]">
            Note (optional)
            <input
              type="text"
              value={newUpsell.note}
              onChange={e => setNewUpsell(u => ({ ...u, note: e.target.value }))}
              className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </label>
          <Button size="sm" onClick={logUpsell} disabled={savingUpsell}>
            <Plus className="w-4 h-4 mr-1" /> Log
          </Button>
        </div>
        {upsellError && <p className="px-4 py-2 text-xs text-red-600">{upsellError}</p>}
        <table className="w-full text-sm">
          <tbody>
            {bonusRows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-center text-zinc-400 text-sm">No bonuses this month.</td>
              </tr>
            )}
            {bonusRows.map(row => {
              const name = data?.staff.find(s => s.id === row.staffId)?.name ?? 'Unknown'
              return (
                <tr key={row.key} className="border-b border-zinc-50 last:border-0">
                  <td className="px-4 py-2 text-zinc-900">{name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${row.kind === 'review' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}`}
                    >
                      {row.kind === 'review' ? 'Review' : 'Upsell'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-500">{row.date}</td>
                  <td className="px-4 py-2 text-zinc-500">{row.detail}</td>
                  <td className={`px-4 py-2 font-medium ${row.kind === 'review' ? 'text-amber-700' : 'text-emerald-700'}`}>
                    +{fmtEuros(row.amountCents)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {row.kind === 'upsell' && row.id && (
                      <button onClick={() => deleteUpsell(row.id!)} aria-label="Delete" className="text-zinc-300 hover:text-red-600">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Entries needing review */}
      {flaggedEntries.length > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-zinc-700">Needs review</h3>
            <span className="text-xs text-zinc-400">({flaggedEntries.length})</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs font-medium text-zinc-400 uppercase">
                <th className="px-4 py-2">Staff</th>
                <th className="px-4 py-2">Clock in</th>
                <th className="px-4 py-2">Clock out</th>
                <th className="px-4 py-2 text-right">Hours</th>
                <th className="px-4 py-2 text-right">Pay</th>
                <th className="px-4 py-2">Flag</th>
              </tr>
            </thead>
            <tbody>
              {flaggedEntries.map(e => {
                const name = data?.staff.find(s => s.id === e.staff_id)?.name ?? 'Unknown'
                const minutes = entryMinutes(e)
                return (
                  <tr key={e.id} className="border-b border-zinc-50">
                    <td className="px-4 py-2 text-zinc-900">{name}</td>
                    <td className="px-4 py-2 text-zinc-600">
                      {new Date(e.clock_in_at).toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam',
                      })}{' '}
                      {formatAmsterdamTime(e.clock_in_at)}
                    </td>
                    <td className="px-4 py-2 text-zinc-600">
                      {e.clock_out_at ? formatAmsterdamTime(e.clock_out_at) : (
                        <span className="text-amber-700">still open</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-600">
                      {minutes === null ? '—' : formatMinutes(minutes)}
                    </td>
                    <td className="px-4 py-2 text-right text-zinc-600">
                      {minutes === null ? '—' : fmtEuros(entryPayCents(e))}
                    </td>
                    <td className="px-4 py-2">
                      {e.flag ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                          {FLAG_LABEL[e.flag] ?? e.flag}
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          Open
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
