'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { adminMutate } from '@/hooks/useAdminSave'
import { formatAmsterdamTime } from '@/lib/utils'
import { Unlinked, isUnlinked } from './Unlinked'

interface MePayload {
  staff: { id: string; name: string; role: string }
  openEntry: { id: string; clock_in_at: string; shift_id: string | null } | null
  nextShift: {
    id: string
    date: string
    start_at: string
    end_at: string
    status: string
    notes: string | null
    boats: { name: string } | null
  } | null
}

export default function CaptainHomePage() {
  const { data, isLoading, error, refresh } = useAdminFetch<MePayload>('/api/captain/me')
  const [clocking, setClocking] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (isUnlinked(error)) return <Unlinked />

  const checkedIn = !!data?.openEntry

  async function clock(action: 'in' | 'out') {
    setClocking(true)
    setMessage(null)
    try {
      const result = await adminMutate<{ changed: boolean; message: string }>(
        '/api/captain/clock',
        'POST',
        { action },
      )
      setMessage(result.message)
      refresh()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setClocking(false)
    }
  }

  const next = data?.nextShift

  return (
    <div className="p-4 sm:p-8 max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900">
          {data ? `Ahoy, ${data.staff.name.split(' ')[0]}` : 'Ahoy'}
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          {checkedIn
            ? `Checked in since ${formatAmsterdamTime(data!.openEntry!.clock_in_at)}.`
            : 'Not checked in.'}
        </p>
      </div>

      {isLoading && !data && (
        <div className="flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}
      {error && !isUnlinked(error) && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* Next shift */}
      {data && (
        <div className="bg-white rounded-2xl border border-zinc-200 p-5 space-y-1">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Next shift</p>
          {next ? (
            <>
              <p className="text-lg font-semibold text-zinc-900">
                {new Date(next.start_at).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  timeZone: 'Europe/Amsterdam',
                })}
              </p>
              <p className="text-sm text-zinc-600">
                {formatAmsterdamTime(next.start_at)}–{formatAmsterdamTime(next.end_at)} ·{' '}
                {next.boats?.name ?? 'boat tbd'}
              </p>
              {next.notes && <p className="text-xs text-zinc-400 pt-1">{next.notes}</p>}
            </>
          ) : (
            <p className="text-sm text-zinc-500">Nothing on the rota yet. Enjoy the calm.</p>
          )}
        </div>
      )}

      {/* The big button */}
      {data && (
        <button
          onClick={() => clock(checkedIn ? 'out' : 'in')}
          disabled={clocking}
          className={`w-full rounded-2xl py-6 text-lg font-semibold text-white transition-colors disabled:opacity-60 min-h-[64px] ${
            checkedIn ? 'bg-zinc-800 hover:bg-zinc-700' : 'bg-emerald-600 hover:bg-emerald-700'
          }`}
        >
          {clocking ? (
            <Loader2 className="w-5 h-5 animate-spin mx-auto" />
          ) : checkedIn ? (
            'Check out'
          ) : (
            'Check in'
          )}
        </button>
      )}

      {message && (
        <p className="text-sm text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
          {message}
        </p>
      )}
    </div>
  )
}
