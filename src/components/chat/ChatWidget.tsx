'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronDown, MessageCircle, Sailboat, Send } from 'lucide-react'
import { Linkify } from './Linkify'

interface ChatMessage {
  id: string
  direction: 'in' | 'out'
  body: string
  author_name: string | null
  created_at: string
}

const TOKEN_KEY = 'oc_chat_token'
const POLL_MS = 5000

/**
 * Floating customer chat — the public side of the inbox.
 * No token yet → a tiny start form; afterwards a polling thread view.
 * The token in localStorage IS the session: no login, no cookies.
 */
export function ChatWidget() {
  const t = useTranslations('chat')
  const locale = useLocale()
  const pathname = usePathname()

  const [open, setOpen] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY))
  }, [])

  const poll = useCallback(async (tok: string) => {
    try {
      const res = await fetch(`/api/chat/${tok}`)
      const json = await res.json().catch(() => null)
      if (res.status === 404) {
        // Conversation gone (or token invalid) — start fresh next time.
        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
        setMessages([])
        return
      }
      if (json?.ok) setMessages(json.data.messages)
    } catch {
      /* transient network errors: next poll will catch up */
    }
  }, [])

  // Poll while the panel is open.
  useEffect(() => {
    if (!open || !token) return
    poll(token)
    const id = setInterval(() => poll(token), POLL_MS)
    return () => clearInterval(id)
  }, [open, token, poll])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Not on admin/captain screens — they have their own world.
  if (pathname.includes('/admin') || pathname.includes('/captain')) return null

  async function startChat(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message: draft, locale }),
      })
      const json = await res.json().catch(() => null)
      if (!json?.ok) throw new Error(json?.error ?? 'failed')
      localStorage.setItem(TOKEN_KEY, json.data.token)
      setToken(json.data.token)
      setDraft('')
      poll(json.data.token)
    } catch {
      setError(t('error'))
    } finally {
      setBusy(false)
    }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!token || !draft.trim()) return
    const body = draft.trim()
    setDraft('')
    setError(null)
    // Optimistic bubble; the next poll replaces it with the stored row.
    setMessages(prev => [
      ...prev,
      { id: `tmp-${prev.length}`, direction: 'in', body, author_name: null, created_at: new Date().toISOString() },
    ])
    try {
      const res = await fetch(`/api/chat/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: body }),
      })
      const json = await res.json().catch(() => null)
      if (!json?.ok) throw new Error(json?.error ?? 'failed')
    } catch {
      setError(t('error'))
      setDraft(body)
    }
  }

  const inputClasses =
    'w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white transition-colors'

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={t('openLabel')}
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary-light hover:scale-105 transition-all"
      >
        {open ? <ChevronDown className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed z-50 bottom-24 right-5 left-5 sm:left-auto sm:w-[380px] max-h-[75vh] bg-zinc-50 rounded-[28px] shadow-2xl ring-1 ring-black/5 flex flex-col overflow-hidden">
          {/* Header — Trengo-style: big, white, friendly */}
          <div className="bg-white px-6 pt-6 pb-2 relative">
            <button
              onClick={() => setOpen(false)}
              aria-label={t('openLabel')}
              className="absolute top-5 right-5 p-1.5 rounded-full text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
            >
              <ChevronDown className="w-5 h-5" />
            </button>
            <p className="text-2xl font-bold text-zinc-900 leading-tight pr-8">
              {t('title')} <span aria-hidden>👋</span>
            </p>
            <span className="inline-flex items-center gap-1.5 mt-2 px-2.5 py-1 rounded-full bg-emerald-600 text-white text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              {t('online')}
            </span>
            <p className="text-[15px] text-zinc-600 mt-3 pb-2">{t('subtitle')}</p>
          </div>

          {/* Wave divider — the header melts into the body */}
          <svg viewBox="0 0 380 22" className="block w-full -mt-px shrink-0" preserveAspectRatio="none" aria-hidden>
            <path d="M0 0 H380 V4 C 290 24, 90 24, 0 4 Z" fill="white" />
          </svg>

          {!token ? (
            // First contact: name + email + message
            <form onSubmit={startChat} className="px-5 pb-5 pt-2 space-y-3 overflow-y-auto">
              <div className="flex items-start gap-2.5">
                <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shrink-0 shadow-sm">
                  <Sailboat className="w-4.5 h-4.5" />
                </div>
                <div className="bg-white rounded-2xl rounded-tl-md shadow-sm px-4 py-3 text-sm text-zinc-700">
                  {t('intro')}
                </div>
              </div>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('name')}
                required
                maxLength={80}
                className={inputClasses}
              />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('email')}
                required
                className={inputClasses}
              />
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder={t('message')}
                required
                rows={3}
                maxLength={2000}
                className={`${inputClasses} resize-none`}
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-primary text-white py-3 text-sm font-semibold hover:bg-primary-light disabled:opacity-50 min-h-[44px] shadow-sm transition-colors"
              >
                {t('start')}
              </button>
            </form>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-4 pb-3 pt-1 space-y-2.5 min-h-[220px]">
                {messages.length === 0 && (
                  <p className="text-xs text-zinc-400 text-center py-4">{t('sent')}</p>
                )}
                {messages.map(m =>
                  m.direction === 'out' ? (
                    // Team message — avatar + white bubble, Trengo-style
                    <div key={m.id} className="flex items-start gap-2.5">
                      <div className="w-9 h-9 rounded-full bg-primary text-white flex items-center justify-center shrink-0 shadow-sm">
                        <Sailboat className="w-4.5 h-4.5" />
                      </div>
                      <div className="max-w-[78%] bg-white rounded-2xl rounded-tl-md shadow-sm px-4 py-2.5 text-sm text-zinc-700 whitespace-pre-wrap">
                        {m.author_name && (
                          <span className="block text-[10px] font-semibold text-zinc-400 mb-0.5">{m.author_name}</span>
                        )}
                        <Linkify text={m.body} className="underline underline-offset-2 break-all text-primary hover:opacity-80" />
                      </div>
                    </div>
                  ) : (
                    // Customer message — primary bubble, right
                    <div key={m.id} className="flex justify-end">
                      <div className="max-w-[78%] bg-primary text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm">
                        <Linkify text={m.body} />
                      </div>
                    </div>
                  ),
                )}
                <div ref={bottomRef} />
              </div>
              {error && <p className="text-xs text-red-600 px-4 pb-1">{error}</p>}
              <form onSubmit={sendMessage} className="flex items-end gap-2 bg-white border-t border-zinc-100 p-3">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      e.currentTarget.form?.requestSubmit()
                    }
                  }}
                  placeholder={t('placeholder')}
                  rows={1}
                  maxLength={2000}
                  className="flex-1 rounded-full border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:bg-white transition-colors"
                />
                <button
                  type="submit"
                  aria-label={t('send')}
                  className="w-11 h-11 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary-light shrink-0 shadow-sm transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  )
}
