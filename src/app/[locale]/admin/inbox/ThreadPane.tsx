'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Loader2, Send, StickyNote } from 'lucide-react'
import { adminMutate } from '@/hooks/useAdminSave'
import { formatAmsterdamTime } from '@/lib/utils'
import type { InboxConversationDetail, InboxMessage } from './types'

interface Props {
  detail: InboxConversationDetail
  onSent: () => void
  /** Mobile drill-in: go back to the list. */
  onBack: () => void
}

/** Middle pane — the thread, chronological, plus the Reply/Note composer. */
export function ThreadPane({ detail, onSent, onBack }: Props) {
  const { conversation, messages } = detail
  const [mode, setMode] = useState<'out' | 'note'>('out')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

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
            <span className="ml-2 text-xs font-normal text-zinc-400 capitalize">{conversation.channel}</span>
          </p>
          {conversation.subject && <p className="text-xs text-zinc-400 truncate">{conversation.subject}</p>}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-zinc-50/50">
        {messages.map(m => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <form onSubmit={send} className="border-t border-zinc-100 p-3 space-y-2">
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

function MessageBubble({ message: m }: { message: InboxMessage }) {
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
  return (
    <div className={`flex ${inbound ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${
          inbound ? 'bg-white border border-zinc-200 text-zinc-800 rounded-bl-sm' : 'bg-primary text-white rounded-br-sm'
        }`}
      >
        {m.body}
        <span className={`block text-[10px] mt-1 ${inbound ? 'text-zinc-400' : 'text-white/60'}`}>
          {!inbound && m.author_name ? `${m.author_name} · ` : ''}
          {formatAmsterdamTime(m.created_at)}
          {m.status === 'failed' && ' · ⚠ failed'}
        </span>
      </div>
    </div>
  )
}
