'use client'

import { useEffect, useState } from 'react'
import { AdminFormModal } from '@/components/admin/ui/AdminFormModal'
import { SelectField, TextField } from '@/components/admin/ui/fields'
import { useAdminSave, adminMutate } from '@/hooks/useAdminSave'
import { CATEGORIES, CATEGORY_KEYS, fullLabel, isCategory } from '@/lib/finance/cockpit/classify/taxonomy'
import { COCKPIT_API, type TransactionApiRow } from './api-types'
import { eurCents, dateNL } from './money'
import { transactionLabel, isIncoming } from './transaction-display'
import { useBoats } from './useBoats'

type MatchField = 'counterparty_name' | 'merchant_name' | 'description' | 'reference'
type Direction = 'in' | 'out' | 'any'

const MATCH_FIELD_LABELS: Record<MatchField, string> = {
  counterparty_name: 'Naam tegenpartij',
  merchant_name: 'Naam handelaar',
  description: 'Omschrijving',
  reference: 'Referentie',
}

const DIRECTION_LABELS: Record<Direction, string> = {
  in: 'Alleen inkomend',
  out: 'Alleen uitgaand',
  any: 'Beide richtingen',
}

interface ClassifyRulePayload {
  match_field: MatchField
  pattern: string
  direction: Direction
}

interface ClassifyPayload {
  category: string
  subcategory?: string
  boat_id?: string
  remember_rule?: boolean
  rule?: ClassifyRulePayload
}

/**
 * Mirrors ClassifyOutcome from src/lib/finance/cockpit/classify/apply.ts —
 * `classification` is the flat, camelCase Classification object (or null when
 * nothing could be decided), `needsReview` sits on the outcome itself.
 */
interface ClassifyOutcome {
  classification: {
    category: string
    subcategory: string | null
    boatId?: string | null
    confidence: number
    reason: string
    source: 'rule' | 'ai' | 'user'
  } | null
  needsReview: boolean
}

interface ClassifyResponse {
  outcome: ClassifyOutcome
  ruleCreated: boolean
}

interface TransactionReviewModalProps {
  open: boolean
  transaction: TransactionApiRow | null
  onClose: () => void
  /** Patch to merge into the row in place — built from the classify response where possible. */
  onSaved: (patch: Partial<TransactionApiRow>) => void
}

function merchantNameOf(tx: TransactionApiRow): string | null {
  const name = tx.merchant?.name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

/**
 * Classify or reclassify one bank transaction: category + subcategory + boat,
 * with an optional "remember this" rule so the same counterparty auto-sorts
 * next time. Opens from a transaction row on the Transacties page.
 */
export function TransactionReviewModal({ open, transaction, onClose, onSaved }: TransactionReviewModalProps) {
  const boats = useBoats(open)
  const { saving, error, setError, run } = useAdminSave()

  const [category, setCategory] = useState<string>('')
  const [subcategory, setSubcategory] = useState<string>('')
  const [boatId, setBoatId] = useState('')
  const [remember, setRemember] = useState(false)
  const [matchField, setMatchField] = useState<MatchField>('description')
  const [pattern, setPattern] = useState('')
  const [direction, setDirection] = useState<Direction>('any')

  useEffect(() => {
    if (!open || !transaction) return
    const merchant = merchantNameOf(transaction)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategory(transaction.category ?? '')
    setSubcategory(transaction.subcategory ?? '')
    setBoatId(transaction.boat_id ?? '')
    setRemember(false)
    setMatchField(merchant ? 'merchant_name' : 'description')
    setPattern(merchant ?? transaction.description?.trim() ?? '')
    setDirection(transaction.amount_cents > 0 ? 'in' : transaction.amount_cents < 0 ? 'out' : 'any')
    setError(null)
  }, [open, transaction, setError])

  if (!transaction) return null

  const subcategoryOptions = isCategory(category) ? CATEGORIES[category].subcategories : null

  function handleCategoryChange(next: string) {
    setCategory(next)
    setSubcategory('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!transaction) return
    if (!category) { setError('Kies een categorie.'); return }
    if (remember && !pattern.trim()) { setError('Vul een patroon in om te onthouden.'); return }

    const txId = transaction.id
    const payload: ClassifyPayload = {
      category,
      subcategory: subcategory || undefined,
      boat_id: boatId || undefined,
      remember_rule: remember,
      ...(remember ? { rule: { match_field: matchField, pattern: pattern.trim(), direction } } : {}),
    }

    run(async () => {
      const result = await adminMutate<ClassifyResponse>(`${COCKPIT_API}/transactions/${txId}/classify`, 'POST', payload)
      const c = result?.outcome?.classification
      onSaved({
        category: c?.category ?? category,
        subcategory: (c?.subcategory ?? subcategory) || null,
        boat_id: (c?.boatId ?? boatId) || null,
        needs_review: result?.outcome?.needsReview ?? false,
        classified_by: c?.source ?? 'user',
        confidence: c?.confidence ?? null,
        classification_reason: c?.reason ?? null,
      })
      onClose()
    })
  }

  const currentLabel = fullLabel(transaction.category, transaction.subcategory)

  return (
    <AdminFormModal
      open={open}
      title="Transactie classificeren"
      subtitle="Wijs een categorie toe, en onthoud desgewenst het patroon voor volgende keer."
      onClose={onClose}
      onSubmit={handleSubmit}
      saving={saving}
      error={error}
      submitLabel="Opslaan"
      maxWidthClass="max-w-lg"
    >
      <div className="rounded-xl border border-zinc-200 p-3 space-y-1.5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-medium text-zinc-900 min-w-0 truncate">{transactionLabel(transaction)}</p>
          <span className={`text-sm font-semibold tabular-nums shrink-0 ${isIncoming(transaction) ? 'text-emerald-700' : 'text-zinc-900'}`}>
            {isIncoming(transaction) ? '+' : ''}{eurCents(transaction.amount_cents)}
          </span>
        </div>
        <p className="text-xs text-zinc-500">{dateNL(transaction.completed_at ?? transaction.created_at)}</p>
        {transaction.category && (
          <p className="text-xs text-zinc-500">
            Huidige classificatie: <span className="font-medium text-zinc-700">{currentLabel}</span>
            {transaction.confidence != null && ` · ${Math.round(transaction.confidence * 100)}%`}
            {transaction.needs_review && ' · controle nodig'}
          </p>
        )}
        {transaction.classification_reason && (
          <p className="text-xs text-zinc-400 italic">&ldquo;{transaction.classification_reason}&rdquo;</p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SelectField label="Categorie" value={category} onChange={e => handleCategoryChange(e.target.value)} required>
          <option value="">Kies een categorie…</option>
          {CATEGORY_KEYS.map(key => <option key={key} value={key}>{CATEGORIES[key].label}</option>)}
        </SelectField>
        <SelectField label="Subcategorie" value={subcategory} onChange={e => setSubcategory(e.target.value)} disabled={!subcategoryOptions}>
          <option value="">—</option>
          {subcategoryOptions && Object.entries(subcategoryOptions as Record<string, string>).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </SelectField>
      </div>

      {boats.length > 0 && (
        <SelectField label="Boot" value={boatId} onChange={e => setBoatId(e.target.value)} hint="Leeg = gedeeld / hele bedrijf.">
          <option value="">Gedeeld</option>
          {boats.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </SelectField>
      )}

      <label className="flex items-center gap-2 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={remember}
          onChange={e => setRemember(e.target.checked)}
          className="w-4 h-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500"
        />
        Onthoud deze regel
      </label>

      {remember && (
        <div className="rounded-xl border border-zinc-200 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <SelectField label="Match op" value={matchField} onChange={e => setMatchField(e.target.value as MatchField)}>
              {(Object.keys(MATCH_FIELD_LABELS) as MatchField[]).map(k => <option key={k} value={k}>{MATCH_FIELD_LABELS[k]}</option>)}
            </SelectField>
            <SelectField label="Richting" value={direction} onChange={e => setDirection(e.target.value as Direction)}>
              {(Object.keys(DIRECTION_LABELS) as Direction[]).map(k => <option key={k} value={k}>{DIRECTION_LABELS[k]}</option>)}
            </SelectField>
          </div>
          <TextField label="Patroon" value={pattern} onChange={e => setPattern(e.target.value)} placeholder="bijv. Taste Vin" required={remember} />
        </div>
      )}
    </AdminFormModal>
  )
}
