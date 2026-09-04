'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CalendarDays, CalendarPlus, Check, CheckCircle2, Download, Ghost, Globe, Languages, Loader2, Mail, Phone, Plus, Receipt, Sparkles, Wrench, XCircle } from 'lucide-react'
import { adminMutate } from '@/hooks/useAdminSave'
import { replySimilarity } from '@/lib/ghost/similarity'
import { fmtAdminDate, fmtAdminTime } from '@/lib/admin/format'
import { OTA_PLATFORM_NAME } from '@/lib/ota/detect'
import { pickCheapestPrivateOption } from '@/lib/ota/availability-shape'
import { draftNeedsEnglish } from '@/lib/i18n/needs-translation'
import { hasGhostCoPilotContent, type InboxConversationDetail, type InboxFinanceInvoice, type InboxGhostProposal } from './types'

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
  const { conversation, bookings, ghost, financeInvoices } = detail
  const contact = conversation.contact
  const [saving, setSaving] = useState(false)
  // The booking Ghost found by name/date when the contact's own email doesn't
  // match what's on file (a typo) — so it's absent from the email-matched
  // `bookings` list above. Don't show it twice if it's already in there.
  const correctionBookingId = ghost?.bookingCorrection?.payload.correction?.booking_id
  const foundCorrectionBooking =
    correctionBookingId && !bookings.some(b => b.id === correctionBookingId)
      ? ghost?.bookingCorrection?.payload.correction
      : undefined

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
      {hasGhostCoPilotContent(ghost) && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-violet-500 mb-2 inline-flex items-center gap-1.5">
            <Ghost className="w-3.5 h-3.5" /> Ghost co-pilot
          </p>
          {ghost.replyDraft?.payload.reply && (
            <SuggestedReply proposal={ghost.replyDraft} onUseDraft={onUseDraft} onChanged={onChanged} />
          )}
          {ghost.bookingProposal && <BookingApproval proposal={ghost.bookingProposal} onChanged={onChanged} />}
          {ghost.bookingCorrection && <BookingCorrectionApproval proposal={ghost.bookingCorrection} onChanged={onChanged} />}
          {ghost.cancellationRequest && (
            <>
              {ghost.cancellationRequest.payload.reply && (
                <SuggestedReply proposal={ghost.cancellationRequest} onUseDraft={onUseDraft} onChanged={onChanged} />
              )}
              <CancellationApproval proposal={ghost.cancellationRequest} onChanged={onChanged} />
            </>
          )}
          {ghost.otaAvailability && <OtaAvailabilityCard proposal={ghost.otaAvailability} />}
          {ghost.otaBookingReady && <OtaBookingReadyCard proposal={ghost.otaBookingReady} />}
          {ghost.fhImportReady && <FhImportReadyCard proposal={ghost.fhImportReady} onChanged={onChanged} />}
          {ghost.history.length > 0 && <LearningTrail history={ghost.history} />}
        </div>
      )}

      {/* Finance Inbox — §6/§6a. Never alongside the Ghost co-pilot block above:
          a finance-category message never gets a Ghost proposal (see gmail/sync.ts). */}
      {conversation.source_category === 'finance' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
          <p className="text-[10px] font-semibold tracking-widest uppercase text-amber-600 mb-2 inline-flex items-center gap-1.5">
            <Receipt className="w-3.5 h-3.5" /> Factuur controleren
          </p>
          {financeInvoices.length === 0 ? (
            <p className="text-xs text-zinc-400">Geen PDF-bijlage gevonden in dit bericht.</p>
          ) : (
            <div className="space-y-2.5">
              {financeInvoices.map(invoice => (
                <FinanceInvoiceReview key={invoice.id} invoice={invoice} onChanged={onChanged} />
              ))}
            </div>
          )}
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

      {/* Bookings — matched by contact email, plus any Ghost found by name/date
          when the contact's email doesn't match what's on the booking (a typo). */}
      <div>
        <p className="text-[10px] font-semibold tracking-widest uppercase text-zinc-400 mb-2">Bookings</p>
        {bookings.length === 0 && !foundCorrectionBooking && (
          <p className="text-xs text-zinc-400">No bookings found for this customer.</p>
        )}
        <div className="space-y-2">
          {foundCorrectionBooking && (
            <div className="rounded-lg border border-violet-200 bg-violet-50/40 px-3 py-2">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-violet-500 mb-1 inline-flex items-center gap-1">
                <Ghost className="w-3 h-3" /> Found by Ghost — email on file differs
              </p>
              <p className="text-xs font-semibold text-zinc-800 flex items-center gap-1.5">
                <CalendarDays className="w-3 h-3 text-zinc-400" />
                {fmtAdminDate(foundCorrectionBooking.booking_date ?? null)}
                {foundCorrectionBooking.start_time ? ` · ${fmtAdminTime(foundCorrectionBooking.start_time)}` : ''}
              </p>
              <p className="text-xs text-zinc-500 mt-0.5 truncate">{foundCorrectionBooking.listing_title ?? 'Cruise'}</p>
              {foundCorrectionBooking.guest_count && (
                <p className="text-[11px] text-zinc-400 mt-0.5">{foundCorrectionBooking.guest_count} guests</p>
              )}
            </div>
          )}
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
  const otherLanguage = draftNeedsEnglish(proposal.payload.language)

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
      <div className="rounded-lg bg-white border border-violet-100 px-3 py-2 text-xs text-zinc-700 whitespace-pre-wrap max-h-64 overflow-y-auto">
        {reply}
      </div>
      {/* You read English + Dutch — show English for anything else. */}
      {otherLanguage && replyEn && (
        <div className="mt-1 rounded-lg bg-zinc-50 border border-zinc-200 px-3 py-2 text-xs text-zinc-500 whitespace-pre-wrap max-h-64 overflow-y-auto">
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
      <ToolsUsed tools={proposal.payload.tools_used} />
    </div>
  )
}

/** Tool names are snake_case identifiers — "check_shared_cruise_to_join" → "Check shared cruise to join". */
function toolLabel(name: string): string {
  const spaced = name.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * What the agent actually did to produce this draft — the real tool calls it
 * made, not a claim about them. Reads payload.tools_used (just the names; the
 * full `steps` blob is deliberately never fetched on the thread poll — see
 * the select in api/admin/inbox/conversations/[id]/route.ts).
 *
 * Renders nothing when the agent answered from context alone (no tool calls),
 * rather than an empty "Checked:" label implying something was skipped.
 */
function ToolsUsed({ tools }: { tools?: string[] }) {
  if (!tools?.length) return null
  return (
    <div className="mt-2 pt-2 border-t border-violet-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Checked before drafting</p>
      <div className="flex flex-wrap gap-1">
        {tools.map(t => (
          <span key={t} className="inline-flex items-center gap-1 rounded-full bg-white border border-violet-100 px-2 py-0.5 text-[10px] text-zinc-600">
            <Wrench className="w-2.5 h-2.5 text-violet-400" />
            {toolLabel(t)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Shared by every card below that names an OTA/FareHarbor platform in its copy. */
function platformLabel(platform: string | null | undefined, fallback: string): string {
  return platform ? (OTA_PLATFORM_NAME[platform as keyof typeof OTA_PLATFORM_NAME] ?? platform) : fallback
}

/** The `date · time · guests[ · experience]` line repeated across the OTA/FH cards below. */
function RequestSummaryLine({ date, time, guests, experienceName }: { date: string | null | undefined; time?: string | null; guests?: number | null; experienceName?: string | null }) {
  return (
    <p className="flex items-center gap-1.5 text-zinc-600">
      <CalendarDays className="w-3 h-3 text-zinc-400 shrink-0" />
      {date ?? 'date unclear'}
      {time ? ` · ${time}` : ''}
      {guests ? ` · ${guests} guests` : ''}
      {experienceName ? ` · ${experienceName}` : ''}
    </p>
  )
}

/**
 * A new OTA booking request — read-only. There is no "reply" to send
 * (Withlocals/GetMyBoat handle all guest communication themselves), so
 * unlike SuggestedReply/BookingApproval this card has no action button —
 * just the facts, plus the real availability-check result driven by the
 * actual tool call, not AI prose. See lib/ota/handle-message.ts.
 */
function OtaAvailabilityCard({ proposal }: { proposal: InboxGhostProposal }) {
  const p = proposal.payload
  const platform = platformLabel(p.platform, 'OTA')
  const req = p.requested
  const { bookable: hasBookable, cheapest } = pickCheapestPrivateOption(p.availability?.listings)
  const bookable = p.checked ? hasBookable : null

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
        {platform} booking request{p.booking_ref ? ` · ref ${p.booking_ref}` : ''}
      </p>
      <div className="rounded-lg bg-white border border-violet-100 px-3 py-2 text-xs text-zinc-700 space-y-1">
        {req && <RequestSummaryLine date={req.date} time={req.time} guests={req.guests} />}
        <p className="flex items-center gap-1.5">
          {bookable === true && <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />}
          {bookable === false && <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />}
          {bookable === true && (
            <span className="text-green-700">
              Bookable{cheapest ? ` — ${cheapest.name}, from €${cheapest.price_eur}` : ''}
            </span>
          )}
          {bookable === false && <span className="text-red-600">Not available as a private cruise at this time</span>}
          {bookable === null && <span className="text-zinc-400">Availability could not be checked</span>}
        </p>
      </div>
      <p className="mt-1.5 text-[11px] text-zinc-400">
        This is a platform notification, not a customer message — respond/confirm on {platform}&apos;s own site.
      </p>
    </div>
  )
}

/**
 * The guest already paid on the OTA's platform, and this booking doesn't
 * exist in FareHarbor yet — the boat's capacity for this slot isn't actually
 * reserved until someone creates it. "Create booking" deep-links into the
 * normal admin booking tool with the known details pre-filled; it deliberately
 * does not auto-construct the FareHarbor booking itself (no reliable way yet
 * to resolve the OTA's stated experience name to an exact listing/rate pk
 * without a human's eyes on it).
 */
function OtaBookingReadyCard({ proposal }: { proposal: InboxGhostProposal }) {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const p = proposal.payload
  const platform = platformLabel(p.platform, 'OTA')
  const parsed = p.parsed

  // Pre-fills the manual booking tool with what the OTA's own confirmation
  // email already gave us (date, guest count, guest's first name, a note with
  // the OTA reference) — not a one-click auto-book. Picking the actual
  // FareHarbor listing/time slot and entering payment (Withlocals is already
  // an admin-selectable booking source, so no capacity gets double-charged)
  // still happens by hand on that page, same as any other booking; this just
  // saves re-typing what's already known. See BOOKING_SOURCES in constants.ts.
  function createBooking() {
    const query = new URLSearchParams()
    query.set('otaPlatform', p.platform ?? 'other')
    if (parsed?.dateISO) query.set('date', parsed.dateISO)
    if (parsed?.guests) query.set('guests', String(parsed.guests))
    if (p.guest_name) query.set('guestName', p.guest_name)
    if (p.booking_ref) query.set('otaRef', p.booking_ref)
    router.push(`/${locale}/admin/fareharbor?${query.toString()}`)
  }

  return (
    <div className="mt-2 pt-2 border-t border-violet-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
        {platform} booking confirmed{p.booking_ref ? ` · ref ${p.booking_ref}` : ''}
      </p>
      <div className="rounded-lg bg-white border border-emerald-100 px-3 py-2 text-xs text-zinc-700 space-y-1">
        <p className="flex items-center gap-1.5 text-emerald-700 font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Guest already paid on {platform}
        </p>
        {parsed && <RequestSummaryLine date={parsed.date} time={parsed.time} guests={parsed.guests} />}
      </div>
      <button
        onClick={createBooking}
        className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 text-xs font-semibold transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Create booking
      </button>
      <p className="mt-1.5 text-[11px] text-zinc-400">
        Opens the booking tool with the date, guest count, and name pre-filled — pick the real FareHarbor slot and
        confirm there. This guest paid on {platform}, not through us, so no payment is collected again.
      </p>
    </div>
  )
}

/**
 * The shared busy/error/action wiring behind every proposal-approval card
 * below (FhImportReadyCard, BookingApproval, BookingCorrectionApproval,
 * CancellationApproval) — each used to hand-roll its own useState pair +
 * try/catch/finally around the identical `adminMutate(proposals/:id, 'POST',
 * body)` call. `onError` covers the one thing that varies per card: resetting
 * whatever "confirming" step that card was on when the request failed.
 */
function useProposalAction(proposalId: string, onChanged: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(body: Record<string, unknown>, fallbackError: string, onError?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await adminMutate(`/api/admin/ghost/proposals/${proposalId}`, 'POST', body)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError)
      onError?.()
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

/**
 * A 3rd-party API (so far: GetYourGuide) already created this booking
 * directly inside FareHarbor — no reply to send, and nothing to create
 * either (unlike OtaBookingReadyCard above, where nothing exists in
 * FareHarbor yet). The gap here is one level down: it just hasn't been
 * pulled into our own database, so Bookings/Scheduling/Planning don't know
 * about it. "Import booking" re-fetches it live from FareHarbor and inserts
 * the matching row — see lib/fareharbor/import-booking.ts.
 */
function FhImportReadyCard({ proposal, onChanged }: { proposal: InboxGhostProposal; onChanged: () => void }) {
  const { busy, error, run } = useProposalAction(proposal.id, onChanged)
  const p = proposal.payload
  const platform = platformLabel(p.platform, 'FareHarbor')
  const parsed = p.parsed
  const executed = proposal.status === 'executed'

  function importBooking() {
    return run({ action: 'import_fh_booking' }, 'Could not import this booking')
  }

  return (
    <div className="mt-2 pt-2 border-t border-violet-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">
        {platform} booking · already in FareHarbor{p.booking_ref ? ` · #${p.booking_ref}` : ''}
      </p>
      <div className="rounded-lg bg-white border border-amber-100 px-3 py-2 text-xs text-zinc-700 space-y-1">
        <p className="flex items-center gap-1.5 text-amber-700 font-semibold">
          <Download className="w-3.5 h-3.5 shrink-0" /> Not yet in our database
        </p>
        {parsed && <RequestSummaryLine date={parsed.date} time={parsed.time} guests={parsed.guests} experienceName={parsed.experienceName} />}
      </div>

      {executed ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
          <Check className="w-3.5 h-3.5" /> Imported from {platform}
        </p>
      ) : (
        <button
          onClick={importBooking}
          disabled={busy}
          className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Import booking
        </button>
      )}
      <p className="mt-1.5 text-[11px] text-zinc-400">
        Pulls the real details from FareHarbor and adds it to Bookings, Scheduling and Planning. {platform} already collected
        payment — no charge happens here.
      </p>
      {/* Only ever meaningful before success — a stale error from a rejected
          double-click must not linger once the first request's own response
          comes back and flips this to executed. */}
      {!executed && error && <p className="mt-1 text-xs text-red-600">{error}</p>}
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

/** The two-step "this touches a REAL booking" confirm, shared by the primary + each alternative. */
function ConfirmCreate({
  onYes,
  onCancel,
  busy,
  message = (
    <>
      This creates a <span className="font-semibold">real FareHarbor booking</span> (recorded as complimentary — no
      payment taken) and sends the customer a confirmation email. Continue?
    </>
  ),
  confirmLabel = 'Yes, create it',
}: {
  onYes: () => void
  onCancel: () => void
  busy: boolean
  message?: React.ReactNode
  confirmLabel?: string
}) {
  return (
    <div className="mt-1.5">
      <p className="text-[11px] text-zinc-500 mb-1.5">{message}</p>
      <div className="flex items-center gap-2">
        <button
          onClick={onYes}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarPlus className="w-3.5 h-3.5" />}
          {confirmLabel}
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
  const { busy, error, run } = useProposalAction(proposal.id, onChanged)
  // null = idle; 'primary' = confirming the proposed slot; number = confirming that alternative.
  const [confirming, setConfirming] = useState<'primary' | number | null>(null)
  const b = proposal.payload.booking
  const verdict = proposal.payload.verdict
  const executed = proposal.status === 'executed'
  const alternatives = verdict?.alternatives ?? []
  if (!b) return null

  function book(altIndex?: number) {
    return run(
      { action: 'book', ...(altIndex != null ? { alternative_index: altIndex } : {}) },
      'Could not create the booking',
      () => setConfirming(null),
    )
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

const CORRECTION_FIELD_LABEL: Record<string, string> = {
  customer_email: 'email address',
}

/**
 * The contact-fix action: approve a booking_correction → patch the matched
 * booking's contact field and resend its confirmation email. Never creates
 * or cancels a booking — same atomic-claim shape as BookingApproval above,
 * just a narrower blast radius (one column on one existing row).
 */
function BookingCorrectionApproval({ proposal, onChanged }: { proposal: InboxGhostProposal; onChanged: () => void }) {
  const { busy, error, run } = useProposalAction(proposal.id, onChanged)
  const [confirming, setConfirming] = useState(false)
  const c = proposal.payload.correction
  const executed = proposal.status === 'executed'
  if (!c?.new_value) return null
  const fieldLabel = (c.field && CORRECTION_FIELD_LABEL[c.field]) ?? c.field ?? 'contact detail'

  function apply() {
    return run({ action: 'correct_booking' }, 'Could not apply the correction', () => setConfirming(false))
  }

  return (
    <div className="mt-2 pt-2 border-t border-violet-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Found their real booking</p>
      <div className="rounded-lg bg-white border border-indigo-100 px-3 py-2 text-xs text-indigo-900">
        Correct the {fieldLabel} on their booking to <span className="font-semibold">{c.new_value}</span>
      </div>

      {executed ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
          <Check className="w-3.5 h-3.5" /> Corrected &amp; confirmation resent
        </p>
      ) : confirming ? (
        <ConfirmCreate
          onYes={apply}
          onCancel={() => setConfirming(false)}
          busy={busy}
          message={
            <>
              This updates the {fieldLabel} on their <span className="font-semibold">existing booking</span> and
              resends the confirmation email. Continue?
            </>
          }
          confirmLabel="Yes, apply it"
        />
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700"
        >
          <CalendarPlus className="w-3.5 h-3.5" /> Approve &amp; resend confirmation
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

/**
 * The money action: approve a cancellation_request → cancel it in FareHarbor
 * and refund via Stripe for real. Every € here comes from
 * payload.cancellation_terms (policy-computed, stored right after the
 * proposal was drafted — see cancellation-terms.ts) — never AI prose. The
 * server recomputes it AGAIN at the moment of the click, so this display copy
 * is exactly that: display only.
 */
function CancellationApproval({ proposal, onChanged }: { proposal: InboxGhostProposal; onChanged: () => void }) {
  const { busy, error, run } = useProposalAction(proposal.id, onChanged)
  const [confirming, setConfirming] = useState<'suggested' | 'none' | null>(null)
  const terms = proposal.payload.cancellation_terms
  const executed = proposal.status === 'executed'
  if (!proposal.payload.cancellation?.booking_id) return null

  function apply(refundOption: 'suggested' | 'none') {
    return run({ action: 'cancel_booking', refundOption }, 'Could not cancel the booking', () => setConfirming(null))
  }

  const refundEur = ((terms?.refundCents ?? 0) / 100).toFixed(2)
  const paidEur = ((terms?.amountPaidCents ?? 0) / 100).toFixed(2)

  return (
    <div className="mt-2 pt-2 border-t border-violet-100">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Wants to cancel</p>
      <div className="rounded-lg bg-white border border-rose-100 px-3 py-2 text-xs text-zinc-700 space-y-1">
        {terms?.listingTitle && (
          <p className="font-semibold text-zinc-900">
            {terms.listingTitle}
            {terms.departureAt ? ` · ${fmtAdminDate(terms.departureAt)} ${fmtAdminTime(terms.departureAt)}` : ''}
          </p>
        )}
        {terms?.policySummary && <p className="text-zinc-500">{terms.policySummary}</p>}
        {terms && (
          <p>
            Paid <span className="font-semibold">€{paidEur}</span> → refund{' '}
            <span className="font-semibold text-emerald-700">€{refundEur}</span>
          </p>
        )}
      </div>

      {executed ? (
        <p className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
          <Check className="w-3.5 h-3.5" /> Cancelled &amp; refund processed
        </p>
      ) : terms?.isOtaBooking ? (
        <p className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          Booked through {terms.bookingSource} — cancel it there; it&apos;ll sync back here.
        </p>
      ) : terms && terms.canCancelInFareharbor === false ? (
        <p className="mt-1.5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
          No FareHarbor reference on this booking — cancel it directly in FareHarbor instead.
        </p>
      ) : confirming ? (
        <ConfirmCreate
          onYes={() => apply(confirming)}
          onCancel={() => setConfirming(null)}
          busy={busy}
          message={
            confirming === 'suggested' ? (
              <>
                This cancels the booking in FareHarbor and refunds <span className="font-semibold">€{refundEur}</span> via
                Stripe. Continue?
              </>
            ) : (
              <>
                This cancels the booking in FareHarbor with <span className="font-semibold">no refund</span>. Continue?
              </>
            )
          }
          confirmLabel={confirming === 'suggested' ? 'Yes, cancel & refund' : 'Yes, cancel (no refund)'}
        />
      ) : (
        <div className="mt-1.5 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setConfirming('suggested')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-rose-700"
          >
            <XCircle className="w-3.5 h-3.5" /> Cancel &amp; refund €{refundEur}
          </button>
          <button onClick={() => setConfirming('none')} className="text-xs text-zinc-500 hover:text-zinc-700 underline">
            Cancel, no refund
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

const CHECK_LABEL: Record<string, string> = {
  skipper: 'Skipper',
  booking: 'Dienst',
  date: 'Datum',
  hours: 'Uren',
  rate: 'Tarief',
  amount: 'Bedrag',
  duplicate: 'Dubbele factuur',
  iban: 'IBAN',
}

/** Same busy/error/run shape as useProposalAction, parameterized by action name instead of a fixed agent_proposals URL — an invoice isn't a Ghost proposal. */
function useInvoiceAction(invoiceId: string, onChanged: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(action: 'approve' | 'reject' | 'pay', body: Record<string, unknown>, fallbackError: string, onError?: () => void) {
    setBusy(true)
    setError(null)
    try {
      await adminMutate(`/api/admin/finance/cockpit/invoices/${invoiceId}/${action}`, 'POST', body)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : fallbackError)
      onError?.()
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

/**
 * One PDF's match/checks result (src/lib/finance/invoices/match.ts) with
 * Goedkeuren / Goedkeuren & betalen / Afwijzen actions. Goedkeuren only
 * creates the finance_obligations row, same as a manually entered one.
 * Goedkeuren & betalen does that AND drafts the Revolut transfer — a real
 * money action (though only a draft; Beer still approves it in the Revolut
 * app), so it gets the same two-step ConfirmCreate confirm as a booking
 * cancellation/refund elsewhere in this file, and only shows at all when a
 * supplier IBAN is on file to pay.
 */
function FinanceInvoiceReview({ invoice, onChanged }: { invoice: InboxFinanceInvoice; onChanged: () => void }) {
  const { busy, error, run } = useInvoiceAction(invoice.id, onChanged)
  const [rejecting, setRejecting] = useState(false)
  const [paying, setPaying] = useState(false)
  const [note, setNote] = useState('')
  const ext = invoice.extracted
  const filename = invoice.file_path.split('/').pop() ?? invoice.file_path
  const allOk = invoice.checks.length > 0 && invoice.checks.every(c => c.ok)
  const decided = !!invoice.decision

  return (
    <div className="rounded-lg bg-white border border-amber-100 px-3 py-2 text-xs text-zinc-700 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <span className="font-semibold text-zinc-900 truncate">{invoice.supplier?.name ?? ext?.supplierName ?? 'Onbekende afzender'}</span>
        {ext?.amountCents != null && <span className="font-semibold text-zinc-900 shrink-0">€{(ext.amountCents / 100).toFixed(2)}</span>}
      </div>
      <p className="text-[11px] text-zinc-400 truncate">
        {filename}
        {ext?.invoiceNumber ? ` · #${ext.invoiceNumber}` : ''}
        {ext?.tourDate ? ` · ${ext.tourDate}` : ''}
      </p>

      {invoice.checks.length === 0 ? (
        <p className="text-[11px] text-zinc-400">
          {invoice.status === 'received' ? 'Wordt nog verwerkt…' : 'Kon niet automatisch worden gecontroleerd.'}
        </p>
      ) : (
        <div className="space-y-1">
          {invoice.checks.map(c => (
            <p key={c.key} className="flex items-start gap-1.5">
              {c.ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
              )}
              <span className={c.ok ? 'text-zinc-600' : 'text-red-700'}>
                <span className="font-medium">{CHECK_LABEL[c.key] ?? c.key}:</span> {c.detail}
              </span>
            </p>
          ))}
        </div>
      )}

      {decided ? (
        <p
          className={`inline-flex items-center gap-1 text-xs font-semibold ${
            invoice.decision === 'rejected' ? 'text-red-600' : 'text-emerald-600'
          }`}
        >
          {invoice.decision === 'rejected' ? <XCircle className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
          {invoice.decision === 'rejected'
            ? 'Afgewezen'
            : invoice.status === 'payment_pending'
              ? 'Betaling klaargezet in Revolut'
              : invoice.decision === 'approved_override'
                ? 'Goedgekeurd (met afwijking)'
                : 'Goedgekeurd'}
          {invoice.decision_note ? ` — ${invoice.decision_note}` : ''}
        </p>
      ) : rejecting ? (
        <div className="space-y-1.5">
          <textarea
            value={note}
            onChange={ev => setNote(ev.target.value)}
            placeholder="Reden (optioneel)"
            rows={2}
            className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => run('reject', { note: note.trim() || undefined }, 'Kon factuur niet afwijzen')}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <XCircle className="w-3.5 h-3.5" />} Ja, afwijzen
            </button>
            <button onClick={() => setRejecting(false)} disabled={busy} className="text-xs text-zinc-500 hover:text-zinc-700">
              Annuleren
            </button>
          </div>
        </div>
      ) : paying ? (
        <ConfirmCreate
          onYes={() => run('pay', {}, 'Kon betaling niet klaarzetten', () => setPaying(false))}
          onCancel={() => setPaying(false)}
          busy={busy}
          message={
            <>
              Dit maakt een <span className="font-semibold">betaalopdracht klaar in Revolut</span> voor{' '}
              <span className="font-semibold">€{ext?.amountCents != null ? (ext.amountCents / 100).toFixed(2) : '?'}</span> aan{' '}
              {invoice.supplier?.name ?? ext?.supplierName}. Er wordt nog niets overgemaakt — jij keurt hem daarna goed in de
              Revolut app. Doorgaan?
            </>
          }
          confirmLabel="Ja, klaarzetten"
        />
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => run('approve', {}, 'Kon factuur niet goedkeuren')}
            disabled={busy}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50 ${
              allOk ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {allOk ? 'Goedkeuren' : 'Toch goedkeuren'}
          </button>
          {invoice.supplier?.iban && (
            <button
              onClick={() => setPaying(true)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              <CalendarPlus className="w-3.5 h-3.5" /> Goedkeuren &amp; betalen
            </button>
          )}
          <button onClick={() => setRejecting(true)} disabled={busy} className="text-xs text-zinc-500 hover:text-zinc-700 underline">
            Afwijzen
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
