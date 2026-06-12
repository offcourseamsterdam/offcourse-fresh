'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { MessageCircle, Send, X } from 'lucide-react'

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

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={t('openLabel')}
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center hover:bg-primary-light transition-colors"
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed z-50 bottom-24 right-5 left-5 sm:left-auto sm:w-[360px] max-h-[70vh] bg-white rounded-2xl shadow-2xl border border-zinc-200 flex flex-col overflow-hidden">
          <div className="bg-primary text-white px-4 py-3">
            <p className="font-semibold leading-tight">{t('title')}</p>
            <p className="text-xs text-white/70">{t('subtitle')}</p>
          </div>

          {!token ? (
            // First contact: name + email + message
            <form onSubmit={startChat} className="p-4 space-y-3 overflow-y-auto">
              <p className="text-sm text-zinc-600">{t('intro')}</p>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={t('name')}
                required
                maxLength={80}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder={t('email')}
                required
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                placeholder={t('message')}
                required
                rows={3}
                maxLength={2000}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {error && <p className="text-xs text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-primary text-white py-2.5 text-sm font-medium hover:bg-primary-light disabled:opacity-50 min-h-[44px]"
              >
                {t('start')}
              </button>
            </form>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-[200px]">
                {messages.length === 0 && (
                  <p className="text-xs text-zinc-400 text-center py-4">{t('sent')}</p>
                )}
                {messages.map(m => (
                  <div key={m.id} className={`flex ${m.direction === 'in' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
                        m.direction === 'in'
                          ? 'bg-primary text-white rounded-br-sm'
                          : 'bg-zinc-100 text-zinc-800 rounded-bl-sm'
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>
              {error && <p className="text-xs text-red-600 px-3 pb-1">{error}</p>}
              <form onSubmit={sendMessage} className="flex items-end gap-2 border-t border-zinc-100 p-2">
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
                  className="flex-1 rounded-lg border border-zinc-300 px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <button
                  type="submit"
                  aria-label={t('send')}
                  className="w-11 h-11 rounded-lg bg-primary text-white flex items-center justify-center hover:bg-primary-light shrink-0"
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
