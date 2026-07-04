'use client'

import { useState } from 'react'
import { CalendarDays, CalendarPlus, Check, Ghost, Globe, Languages, Loader2, Mail, Phone, Sparkles } from 'lucide-react'
import { adminMutate } from '@/hooks/useAdminSave'
import { replySimilarity } from '@/lib/ghost/similarity'
import type { InboxConversationDetail, InboxGhostProposal } from './types'

const NL_EN = /^(english|dutch|en|nl)$/i
const SIM_BADGE: Record<string, { text: string; cls: string }> = {
  match: { text: '≈ matched', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  minor: { text: 'minor edits', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  different: { text: 'you rewrote it', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
}

const STATUS_OPTIONS = ['open', 'pending', 'resolved'] as const

/** Friendly labels for an alternative's relation to the asked-for slot. */
const ALT_KIND_LABEL: Record<string, string> = {
  same_day_earlier: 'same boat · earlier',
  same_day_later: 'same boat · later',
  other_boat: 'other boat',
  other_day: 'another day',
}

interface Props {
  detail: InboxConversationDetail
  onChanged: () => void
  /** Drop a suggested reply into the composer. */
  onUseDraft: (text: string) => void
}

/** Right pane — who you're talking to: Ghost co-pilot, contact card, bookings, workflow. */
export function ContextPane({ detail, onChanged, onUseDraft }: Props) {
  const { conversation, bookings, ghost } = detail
  const contact = conversation.contact
  const [saving, setSaving] = useState(false)

  async function setStatus(status: (typeof STATUS_OPTIONS)[number]) {
    if (status === conversation.status || saving) return
    setSaving(true)
    try {
      await adminMutate(`/api/admin/inbox/conversations/${conversation.id}`, 'PATCH', { status })
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Ghost co-pilot — act on what the agent suggests, where the work happens */}
      {(ghost?.replyDraft || ghost?.bookingProposal) && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-violet-500 mb-2 inline-flex items-center gap-1.5">
            <Ghost className="w-3.5 h-3.5" /> Ghost co-pilot
          </p>
          {ghost.replyDraft?.payload.reply && (
            <SuggestedReply proposal={ghost.replyDraft} onUseDraft={onUseDraft} onChanged={onChanged} />
          )}
          {ghost.bookingProposal && <BookingApproval proposal={ghost.bookingProposal} onChanged={onChanged} />}
          {ghost.history.length > 0 && <LearningTrail history={ghost.history} />}
        </div>
      )}

      {/* Workflow */}
      <div>
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">Status</p>
        <div className="flex items-center gap-1">
          {STATUS_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              disabled={saving}
              className={`px-2.5 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${
                conversation.status === s
                  ? s === 'resolved'
                    ? 'bg-emerald-600 text-white'
                    : s === 'pending'
                      ? 'bg-blue-600 text-white'
                      : 'bg-amber-500 text-white'
                  : 'text-zinc-500 hover:bg-zinc-100'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Contact card */}
      <div>
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">Customer</p>
        <p className="text-sm font-semibold text-zinc-900">{contact?.name ?? 'Unknown'}</p>
        <div className="mt-1.5 space-y-1 text-xs text-zinc-500">
          {contact?.email && (
            <p className="flex items-center gap-1.5">
              <Mail className="w-3 h-3" /> {contact.email}
            </p>
          )}
          {contact?.phone_e164 && (
            <p className="flex items-center gap-1.5">
              <Phone className="w-3 h-3" /> {contact.phone_e164}
            </p>
          )}
          {contact?.locale && (
            <p className="flex items-center gap-1.5">
              <Globe className="w-3 h-3" /> {contact.locale.toUpperCase()}
            </p>
          )}
        </div>
        {contact?.notes && (
          <p className="mt-2 text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
            {contact.notes}
          </p>
        )}
      </div>

      {/* Bookings */}
      <div>
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">Bookings</p>
        {bookings.length === 0 && <p className="text-xs text-zinc-400">No bookings found for this customer.</p>}
        <div className="space-y-2">
          {bookings.map(b => (
            <div key={b.id} className="rounded-lg border border-zinc-200 px-3 py-2">
              <p className="text-xs font-semibold text-zinc-800 flex items-center gap-1.5">
                <CalendarDays className="w-3 h-3 text-zinc-400" />
                {b.booking_date ?? '—'}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{b.listing_title ?? 'Cruise'}</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">
                {b.guest_count ? `${b.guest_count} guests · ` : ''}
                {b.receipt_total_display ?? ''}
                {b.status ? ` · ${b.status}` : ''}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** The suggested reply — with an English read-out when it's not English/Dutch. */
function SuggestedReply({
  proposal,
  onUseDraft,
  onChanged,
}: {
  proposal: InboxGhostProposal
  onUseDraft: (text: string) => void
  onChanged: () => void
}) {
  const [translating, setTranslating] = useState(false)
  const reply = proposal.payload.reply!
  const replyEn = proposal.payload.reply_en
  const otherLanguage = proposal.payload.language && !NL_EN.test(proposal.payload.language)

  async function translate() {
    setTranslating(true)
    try {
      await adminMutate(`/api/admin/ghost/proposals/${proposal.id}`, 'POST', { action: 'translate' })
      onChanged()
    } finally {
      setTranslating(false)
    }
  }

  return (
    <div className="mb-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
        Suggested reply{proposal.payload.language ? ` · ${proposal.payload.language}` : ''}
      </p>
      <div className="rounded-lg bg-white border border-violet-100 px-3 py-2 text-xs text-zinc-700 whitespace-pre-wrap max-h-32 overflow-y-auto">
        {reply}
      </div>
      {/* You read English + Dutch — show English for anything else. */}
      {otherLanguage && replyEn && (
        <div className="mt-1 rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-xs text-zinc-500 whitespace-pre-wrap max-h-28 overflow-y-auto">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-zinc-400 block mb-0.5">In English</span>
          {replyEn}
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-3">
        <button
          onClick={() => onUseDraft(reply)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 hover:underline"
        >
          <Sparkles className="w-3 h-3" /> Use this draft
        </button>
        {otherLanguage && !replyEn && (
          <button
            onClick={translate}
            disabled={translating}
            className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-50"
          >
            {translating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />} Translate to English
          </button>
        )}
      </div>
    </div>
  )
}

/** The per-conversation learning trail: past drafts vs what you actually sent. */
function LearningTrail({ history }: { history: InboxGhostProposal[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2 pt-2 border-t border-violet-100">
      <button onClick={() => setOpen(o => !o)} className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 hover:text-zinc-600">
        What it&apos;s learned here ({history.length}) {open ? '▾' : '▸'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {history.map(h => {
            const draft = h.payload.reply ?? ''
            const sent = h.outcome?.human_reply ?? ''
            const sim = replySimilarity(draft, sent)
            const badge = SIM_BADGE[sim.label]
            return (
              <div key={h.id} className="rounded-lg bg-white border border-zinc-200 px-2.5 py-2 text-[11px]">
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium ${badge.cls}`}>{badge.text}</span>
                <p className="text-zinc-400 mt-1">It drafted: <span className="text-zinc-600">{draft.slice(0, 90)}{draft.length > 90 ? '…' : ''}</span></p>
                <p className="text-zinc-400">You sent: <span className="text-zinc-700">{sent.slice(0, 90)}{sent.length > 90 ? '…' : ''}</span></p>
                {h.outcome?.comparison && (
                  <p className="text-violet-600 mt-1">✨ {h.outcome.comparison.summary}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The two-step "this creates a REAL booking" confirm, shared by the primary + each alternative. */
function ConfirmCreate({ onYes, onCancel, busy }: { onYes: () => void; onCancel: () => void; busy: boolean }) {
  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-zinc-500 mb-1.5">
        This creates a <span className="font-semibold">real FareHarbor booking</span> (recorded as complimentary — no
        payment taken) and sends the customer a confirmation email. Continue?
      </p>
      <div className="flex items-center gap-2">
        <button
          onClick={onYes}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />}
          Yes, create it
        </button>
        <button onClick={onCancel} disabled={busy} className="text-xs text-zinc-500 hover:text-zinc-700">
          Cancel
        </button>
      </div>
    </div>
  )
}

/**
 * The money action: approve a validated booking_proposal → create it for real.
 * When the proposed slot isn't bookable, the agent's validated alternatives show
 * as one-click "Use this" options (each re-resolved + re-validated on the server).
 */
function BookingApproval({ proposal, onChanged }: { proposal: InboxGhostProposal; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // null = idle; 'primary' = confirming the proposed slot; number = confirming that alternative.
  const [confirming, setConfirming] = useState<'primary' | number | null>(null)
  const b = proposal.payload.booking
  const verdict = proposal.payload.verdict
  const executed = proposal.status === 'executed'
  const alternatives = verdict?.alternatives ?? []
  if (!b) return null

  async function book(altIndex?: number) {
    setBusy(true)
    setError(null)
    try {
      await adminMutate(`/api/admin/ghost/proposals/${proposal.id}`, 'POST', {
        action: 'book',
        ...(altIndex != null ? { alternative_index: altIndex } : {}),
      })
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the booking')
      setConfirming(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Proposed booking</p>
      <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2 text-xs text-indigo-900">
        <span className="font-semibold">{b.listing_title}</span>
        <span className="block mt-0.5 text-zinc-600">
          {b.date} · {b.time} · {b.guests} guests{b.option ? ` · ${b.option}` : ''}{b.price_eur ? ` · €${b.price_eur}` : ''}
        </span>
      </div>

      {executed ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
          <Check className="w-3.5 h-3.5" /> Booked
        </p>
      ) : verdict && !verdict.is_bookable ? (
        <p className="mt-1.5 text-xs text-amber-700">That slot is taken — {verdict.error ?? 'unavailable'}.</p>
      ) : confirming === 'primary' ? (
        <ConfirmCreate onYes={() => book()} onCancel={() => setConfirming(null)} busy={busy} />
      ) : (
        <button
          onClick={() => setConfirming('primary')}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700"
        >
          <CalendarPlus className="w-3.5 h-3.5" /> Approve &amp; create booking
        </button>
      )}

      {/* Validated nearby options — each books through the same money path on click. */}
      {!executed && alternatives.length > 0 && (
        <div className="mt-2 pt-2 border-t border-indigo-100">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Other options</p>
          <div className="space-y-1.5">
            {alternatives.map((a, i) => (
              <div key={i} className="rounded-lg bg-white border border-zinc-200 px-2.5 py-1.5 text-[11px]">
                <span className="inline-block text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-100 text-zinc-600 mb-0.5">
                  {ALT_KIND_LABEL[a.kind] ?? a.kind}
                </span>
                <span className="block text-zinc-700">
                  {a.date} · {a.time} · {a.option}
                  {a.price_eur != null ? ` · €${a.price_eur}${a.price_is_quote ? '' : ' est.'}` : ''}
                </span>
                {confirming === i ? (
                  <ConfirmCreate onYes={() => book(i)} onCancel={() => setConfirming(null)} busy={busy} />
                ) : (
                  <button
                    onClick={() => setConfirming(i)}
                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline"
                  >
                    <CalendarPlus className="w-3 h-3" /> Use this
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
