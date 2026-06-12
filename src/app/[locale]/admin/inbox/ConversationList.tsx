'use client'

import { Mail, MessageSquare, Phone } from 'lucide-react'
import { timeAgoShort } from '@/lib/utils'
import type { InboxListItem } from './types'

const CHANNEL_ICON = {
  webchat: MessageSquare,
  email: Mail,
  whatsapp: MessageSquare,
  voice: Phone,
} as const

export const STATUS_FILTERS = ['open', 'pending', 'resolved', 'all'] as const
export type StatusFilter = (typeof STATUS_FILTERS)[number]

interface Props {
  conversations: InboxListItem[]
  selectedId: string | null
  statusFilter: StatusFilter
  onSelect: (id: string) => void
  onFilterChange: (f: StatusFilter) => void
}

/** Left pane — every conversation across all channels, newest activity first. */
export function ConversationList({ conversations, selectedId, statusFilter, onSelect, onFilterChange }: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Filter chips */}
      <div className="flex items-center gap-1 p-2 border-b border-zinc-100">
        {STATUS_FILTERS.map(f => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-2.5 py-1.5 rounded-full text-xs font-medium capitalize transition-colors min-h-[32px] ${
              statusFilter === f ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 && (
          <p className="text-xs text-zinc-400 text-center py-8 px-4">
            No conversations here. The water is calm.
          </p>
        )}
        {conversations.map(c => {
          const Icon = CHANNEL_ICON[c.channel] ?? MessageSquare
          const unread = c.unread_count > 0
          return (
            <button
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`w-full text-left px-3 py-3 border-b border-zinc-50 transition-colors ${
                selectedId === c.id ? 'bg-zinc-100' : 'hover:bg-zinc-50'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className={`flex-1 truncate text-sm ${unread ? 'font-semibold text-zinc-900' : 'text-zinc-700'}`}>
                  {c.contact?.name ?? 'Unknown'}
                </span>
                <span className="text-[10px] text-zinc-400 shrink-0">{timeAgoShort(c.last_message_at)}</span>
                {unread && <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />}
              </div>
              <p className={`mt-0.5 text-xs truncate pl-5.5 ${unread ? 'text-zinc-700' : 'text-zinc-400'}`}>
                {c.snippet_direction === 'out' && '↩ '}
                {c.snippet}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
