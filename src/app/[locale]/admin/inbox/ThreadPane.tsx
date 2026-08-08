'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, CalendarSearch, CheckCircle2, Clock, Languages, Loader2, PanelRightOpen, Send, StickyNote } from 'lucide-react'
import { adminMutate } from '@/hooks/useAdminSave'
import { formatAmsterdamTime } from '@/lib/utils'
import { formatWindowRemaining } from '@/lib/whatsapp/window'
import { Linkify } from '@/components/chat/Linkify'
import { SafeEmailHtml } from '@/components/admin/SafeEmailHtml'
import { WhatsAppIcon } from '@/components/chat/WhatsAppIcon'
import { OTA_PLATFORM_NAME } from '@/lib/ota/detect'
import { isTrustedEmailSender } from '@/lib/email/trusted-senders'
import { AvailabilityFinder } from './AvailabilityFinder'
import type { InboxConversationDetail, InboxMessage } from './types'

interface Props {
  detail: InboxConversationDetail
  onSent: () => void
  /** Mobile drill-in: go back to the list. */
  onBack: () => void
  /** Text pushed in from the Ghost co-pilot's "Use this draft". */
  prefill?: string | null
  onPrefillConsumed?: () => void
  /** Below xl the customer/Ghost pane isn't docked beside the thread — this opens it as a bottom drawer. */
  onOpenContext?: () => void
  /** Show a dot on the context trigger when Ghost has something to act on. */
  contextHasAction?: boolean
}

interface Translation {
  text: string
  language: string
}

/** Middle pane — the thread, chronological, plus the Reply/Note composer. */
export function ThreadPane({ detail, onSent, onBack, prefill, onPrefillConsumed, onOpenContext, contextHasAction }: Props) {
  const { conversation, messages } = detail
  const [mode, setMode] = useState<'out' | 'note'>('out')
  const [draft, setDraft] = useState('')

  // A "Use this draft" click in the co-pilot drops its text into the composer.
  useEffect(() => {
    if (prefill) {
      setDraft(prefill)
      setMode('out')
      onPrefillConsumed?.()
    }
  }, [prefill, onPrefillConsumed])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [translations, setTranslations] = useState<Record<string, Translation>>({})
  const [translating, setTranslating] = useState<Record<string, boolean>>({})
  const [showFinder, setShowFinder] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // WhatsApp's 24h reply window, ticking down live rather than only surfacing
  // when a send actually fails — a minute of drift is fine, so a 30s tick is
  // plenty; no need to re-poll the API just to keep a clock moving.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (conversation.channel !== 'whatsapp' || !conversation.wa_window_expires_at) return
    const interval = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [conversation.channel, conversation.wa_window_expires_at])
  const windowStatus =
    conversation.channel === 'whatsapp' ? formatWindowRemaining(conversation.wa_window_expires_at, now) : null

  async function translate(msgId: string) {
    setTranslating(prev => ({ ...prev, [msgId]: true }))
    try {
      const res = await adminMutate<{ translation: string | null; detected_language: string | null }>(
        `/api/admin/inbox/conversations/${conversation.id}/messages/${msgId}/translate`,
        'POST',
        {},
      )
      if (res.translation) {
        setTranslations(prev => ({ ...prev, [msgId]: { text: res.translation!, language: res.detected_language ?? 'Unknown' } }))
      } else {
        // Already English — show a note
        setTranslations(prev => ({ ...prev, [msgId]: { text: '', language: 'English' } }))
      }
    } catch {
      // silent — button stays available to retry
    } finally {
      setTranslating(prev => ({ ...prev, [msgId]: false }))
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView()
  }, [messages.length, conversation.id])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await adminMutate(`/api/admin/inbox/conversations/${conversation.id}/messages`, 'POST', {
        body: draft.trim(),
        direction: mode,
      })
      setDraft('')
      onSent()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100">
        <button onClick={onBack} className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-zinc-100 text-zinc-500">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-zinc-900 truncate">
            {conversation.contact?.name ?? 'Unknown'}
            <span className="ml-2 inline-flex items-center gap-1 text-xs font-normal text-zinc-400 capitalize">
              {conversation.channel === 'whatsapp' && <WhatsAppIcon className="w-3 h-3" />}
              {conversation.channel}
            </span>
          </p>
          {conversation.ota_status === 'imported' ? (
            <p className="text-xs text-emerald-600 font-medium truncate flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              Imported from {conversation.ota_source ? (OTA_PLATFORM_NAME[conversation.ota_source as keyof typeof OTA_PLATFORM_NAME] ?? conversation.ota_source) : 'the platform'}
            </p>
          ) : (
            conversation.subject && <p className="text-xs text-zinc-400 truncate">{conversation.subject}</p>
          )}
        </div>
        {windowStatus && (
          <span
            title="WhatsApp only allows free-form replies within 24h of the customer's last message; after that, only an approved template works."
            className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap ${
              windowStatus.closed ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            <Clock className="w-3 h-3" /> {windowStatus.label}
          </span>
        )}
        {onOpenContext && (
          <button
            onClick={onOpenContext}
            aria-label="Customer details"
            className="xl:hidden ml-auto relative p-2 rounded-lg hover:bg-zinc-100 text-zinc-500"
          >
            <PanelRightOpen className="w-4 h-4" />
            {contextHasAction && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-500" />}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-zinc-50/50">
        {messages.map(m => (
          <MessageBubble
            key={m.id}
            message={m}
            channel={conversation.channel}
            translation={translations[m.id]}
            translating={!!translating[m.id]}
            onTranslate={() => translate(m.id)}
            trustSender={isTrustedEmailSender(conversation.contact?.email)}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Availability finder — outside the composer <form> (forms can't nest) */}
      {showFinder && (
        <div className="border-t border-zinc-100 p-3 pb-0">
          <AvailabilityFinder
            customerLocale={conversation.contact?.locale ?? null}
            onPick={url => {
              setDraft(prev => (prev ? `${prev.trimEnd()}\n${url}` : url))
              setShowFinder(false)
              setMode('out')
            }}
            onClose={() => setShowFinder(false)}
          />
        </div>
      )}

      {/* Composer */}
      <form onSubmit={send} className={`${showFinder ? '' : 'border-t'} border-zinc-100 p-3 space-y-2`}>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMode('out')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${mode === 'out' ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
          >
            Reply
          </button>
          <button
            type="button"
            onClick={() => setMode('note')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${mode === 'note' ? 'bg-amber-500 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
          >
            <StickyNote className="w-3 h-3" /> Note
          </button>
          <button
            type="button"
            onClick={() => setShowFinder(f => !f)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium inline-flex items-center gap-1 ${showFinder ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
          >
            <CalendarSearch className="w-3 h-3" /> Availability
          </button>
          {error && <span className="text-xs text-red-600 ml-2">{error}</span>}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
            placeholder={mode === 'out' ? 'Reply to the customer…' : 'Internal note — the customer never sees this'}
            rows={2}
            maxLength={2000}
            className={`flex-1 rounded-lg border px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 ${
              mode === 'note'
                ? 'border-amber-300 bg-amber-50 focus:ring-amber-300/40'
                : 'border-zinc-300 focus:ring-zinc-400/30'
            }`}
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="w-11 h-11 rounded-lg bg-zinc-900 text-white flex items-center justify-center hover:bg-zinc-700 disabled:opacity-40 shrink-0"
            aria-label="Send"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </div>
  )
}

function MessageBubble({
  message: m,
  channel,
  translation,
  translating,
  onTranslate,
  trustSender,
}: {
  message: InboxMessage
  channel: InboxConversationDetail['conversation']['channel']
  trustSender?: boolean
  translation?: Translation
  translating?: boolean
  onTranslate?: () => void
}) {
  if (m.direction === 'note') {
    return (
      <div className="flex justify-center">
        <div className="max-w-[85%] rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
          <span className="font-semibold">{m.author_name ?? 'Note'}:</span> <span className="whitespace-pre-wrap">{m.body}</span>
        </div>
      </div>
    )
  }
  const inbound = m.direction === 'in'
  // Email is read, not chatted — a narrow speech-bubble with a tail corner
  // (right for WhatsApp/webchat's actual back-and-forth texting) just cramps
  // longer email prose. Wider, plain-cornered card instead; still aligned
  // and colored by direction so who-said-what stays obvious at a glance.
  const isEmail = channel === 'email'
  // Only ever set on an inbound email that actually had an HTML part (see
  // gmail/client.ts) — our own outbound replies are always plain text.
  const showHtml = inbound && isEmail && !!m.body_html
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'} group`}>
      <div className={`${isEmail ? 'max-w-[92%]' : 'max-w-[75%]'} space-y-1`}>
        <div
          className={`px-3 py-2 text-sm ${showHtml ? '' : 'whitespace-pre-wrap'} ${isEmail ? 'rounded-lg' : 'rounded-2xl'} ${
            inbound
              ? `bg-white border border-zinc-200 text-zinc-800 ${isEmail ? '' : 'rounded-bl-sm'}`
              : `bg-primary text-white ${isEmail ? '' : 'rounded-br-sm'}`
          }`}
        >
          {showHtml ? <SafeEmailHtml html={m.body_html!} trustSender={trustSender} /> : <Linkify text={m.body} />}
          {m.recording_url && (
            <audio controls src={m.recording_url} className="mt-2 h-8 w-full max-w-[220px]" />
          )}
          <span className={`block text-[10px] mt-1 ${inbound ? 'text-zinc-400' : 'text-white/60'}`}>
            {!inbound && m.author_name ? `${m.author_name} · ` : ''}
            {formatAmsterdamTime(m.created_at)}
            {m.status === 'failed' && ' · ⚠ failed'}
          </span>
        </div>

        {/* Translation */}
        {inbound && (
          <div className="pl-1">
            {!translation && (
              <button
                onClick={onTranslate}
                disabled={translating}
                className="inline-flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                {translating
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Languages className="w-3 h-3" />}
                {translating ? 'Translating…' : 'Translate'}
              </button>
            )}
            {translation && translation.language === 'English' && (
              <span className="text-[10px] text-zinc-400">Already in English</span>
            )}
            {translation && translation.language !== 'English' && translation.text && (
              <div className="rounded-lg bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 text-xs text-indigo-900">
                <span className="block text-[9px] font-semibold text-indigo-400 uppercase tracking-wide mb-0.5">
                  {translation.language} → English
                </span>
                <span className="whitespace-pre-wrap">{translation.text}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
