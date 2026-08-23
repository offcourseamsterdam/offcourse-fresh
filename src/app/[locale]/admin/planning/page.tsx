'use client'

import { useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Loader2, RefreshCw, ChevronLeft, ChevronRight, List, Plus, X, Ghost, Search, UserCheck, UserX, Phone, UtensilsCrossed, MessageCircle } from 'lucide-react'
import { useVoice } from '@/components/admin/VoiceProvider'
import { normalizePhoneE164 } from '@/lib/phone/normalize'
import { adminMutate } from '@/hooks/useAdminSave'
import { BookingDetailRow } from '@/components/admin/BookingDetailRow'
import { GhostActivityPanel } from './GhostActivityPanel'
import type { GhostActivityItem } from '@/app/api/admin/planning/ghost-activity/route'
import { BookingStatusBadge } from '@/components/admin/BookingStatusBadge'
import { useAdminFetch } from '@/hooks/useAdminFetch'
import { useBookingsChangedSignal } from '@/hooks/useBookingsChangedSignal'
import { AdminErrorBanner } from '@/components/admin/AdminErrorBanner'
import { fmtAdminTime } from '@/lib/admin/format'
import { getWeekStart, addDays, weekDateStrings, formatWeekRangeLabel, amsDateString } from '@/lib/admin/week'
import { groupBookingsForPlanning, splitGroupsByBoat, resolveBoatForGroup, type PlanningGroup } from '@/lib/admin/planning-groups'
import { topPx, blockMinHeightPx, hourMarks, GRID_HEIGHT_PX, RAIL_WIDTH_PX, leftPx, blockMinWidthPx, hourMarksRow, nowLeftPx, GRID_WIDTH_PX, DATE_RAIL_WIDTH_PX, CHIP_DETAIL_MIN_PX } from '@/lib/admin/planning-time-grid'
import { useTickingClock } from '@/hooks/useTickingClock'
import type { SharedCapacityResult } from '@/lib/admin/shared-capacity'
import { filterCateringItems } from '@/lib/catering/filter'
import type { AdminBooking } from '@/lib/admin/types'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** One row of `shifts` as the Planning view needs it — including the OPEN
 *  ones (no captain yet), which the page used to throw away. */
interface PlanningShift {
  id: string
  date: string
  staff_id: string | null
  booking_id: string | null
  start_at: string
  end_at: string
  status: string
  boat_id: string | null
  staff: { name: string } | null
  fareharbor_availability_pk: number | null
  /** Real membership — every departure this shift covers. */
  shift_bookings: { booking_id: string }[] | null
}

/** "14:00 – 16:30", or just "14:00" when there's no meaningful end time. */
function timeRangeLabel(startTime: string | null, endTime: string | null): string {
  const start = fmtAdminTime(startTime)
  const hasRealEnd = endTime && startTime &&
    Math.abs(new Date(endTime).getTime() - new Date(startTime).getTime()) > 60_000
  return hasRealEnd ? `${start} – ${fmtAdminTime(endTime)}` : start
}

/** One departure card, built around the only question this page exists to
 *  answer: *does this sailing have a captain, and what does that captain need
 *  to know?* Everything on the card earns its place against that job —
 *
 *    when      time range, the anchor for moving work around
 *    what      boat + private/shared, the two things that decide who can run it
 *    WHO       the captain strip — assigned (green) or needs one (amber).
 *              Deliberately the loudest element: an unassigned sailing is the
 *              only thing on this page that requires an action.
 *    load      parties + guests (+ spots left on a shared departure), for
 *              capacity and upsell decisions
 *    per party name, size, phone, catering and the guest's own note — what
 *              the crew actually needs on the day, and how to reach them
 *
 *  Everything else (email, payment, source, status chips for normal bookings)
 *  is one click away in the detail modal and would only dilute the scan.
 *
 *  `dense` (a day split into per-boat sub-columns) tightens spacing only — it
 *  no longer hides fields, because the columns are now wide enough to read.
 *
 *  `capacity` (shared cruises only) is a live FareHarbor lookup, not anything
 *  stored — see the shared-capacity route. */
function DepartureBlock({ group, onSelectBooking, onSelectGroup, onContact, dense = false, capacity, boatName, captainByBookingId }: { group: PlanningGroup; onSelectBooking: (id: string) => void; onSelectGroup?: (group: PlanningGroup) => void; onContact: (booking: AdminBooking, mode: ContactMode) => void; dense?: boolean; capacity?: SharedCapacityResult; boatName?: string | null; captainByBookingId?: Map<string, { name: string; startAt: string; endAt: string }> }) {
  const first = group.bookings[0]
  const isMulti = group.bookings.length > 1
  // A SHARED departure never lists names on the card — not even when only one
  // party has booked so far. A lone "Jason Tully" reads as "one person on a
  // boat" when it's really one booking of two people on a twelve-seat shared
  // cruise, and it goes stale the moment a second party books. What a planner
  // needs here is the load (parties + guests + spots left); who's actually on
  // board is one click away in the group modal. Private cruises are the
  // opposite — one party IS the whole boat, so the name stays.
  const rosterCollapsed = first.category === 'shared'
  // Any booking in this departure resolves the same shift/captain — a shared
  // cruise's several bookings all ride the same boat with the same captain.
  const captain = group.bookings.map(b => captainByBookingId?.get(b.id)).find(Boolean)
  const crewCall = captain ? fmtAdminTime(new Date(new Date(captain.startAt).getTime() - 60 * 60_000).toISOString()) : null
  const categoryLabel = first.category === 'private' ? 'Private' : first.category === 'shared' ? 'Shared' : null
  // Boat identity is text now, not a coloured edge — a name survives being
  // scanned, printed or described out loud in a way a colour bar doesn't.
  const subtitle = [boatName && boatName !== 'Other' ? boatName : null, categoryLabel].filter(Boolean).join(' · ')
  const pad = dense ? 'py-0.5' : 'py-1'

  return (
    // h-full: the card fills its slot exactly, so its height on the grid IS the
    // cruise's duration — a 1.5h cruise reads as 1.5h of water at a glance,
    // whether the card carries three lines or ten. Content that doesn't fit is
    // clipped rather than stretching the card past the cruise's end time.
    <div className="h-full rounded-lg border border-zinc-200 bg-white overflow-hidden shadow-sm">
      {/* When + which boat */}
      <div
        onClick={isMulti ? () => onSelectGroup?.(group) : undefined}
        className={`flex items-baseline justify-between gap-2 px-2.5 ${dense ? 'py-1' : 'py-1.5'} border-b border-zinc-100 bg-zinc-50/70 ${isMulti ? 'cursor-pointer hover:bg-zinc-100 transition-colors' : ''}`}
      >
        <span className="font-semibold text-zinc-900 text-xs tabular-nums whitespace-nowrap">
          {timeRangeLabel(first.start_time, first.end_time)}
        </span>
        {subtitle && <span className="text-[11px] text-zinc-500 truncate">{subtitle}</span>}
      </div>

      {/* Who's running it — the actionable line */}
      {captain ? (
        <div className={`flex items-center gap-1.5 px-2.5 ${pad} border-b border-emerald-100 bg-emerald-50 text-[11px]`}>
          <UserCheck className="w-3 h-3 text-emerald-600 shrink-0" />
          <span className="font-medium text-emerald-800 truncate">{captain.name}</span>
          {crewCall && <span className="text-emerald-600/80 tabular-nums whitespace-nowrap ml-auto">from {crewCall}</span>}
        </div>
      ) : (
        <div className={`flex items-center gap-1.5 px-2.5 ${pad} border-b border-amber-200 bg-amber-50 text-[11px]`}>
          <UserX className="w-3 h-3 text-amber-600 shrink-0" />
          <span className="font-semibold text-amber-800">Needs a captain</span>
        </div>
      )}

      {/* How full it is — and, for a shared departure, the entry point into
          the roster collapsed away below, so this line doubles as "tap to see
          who's on board". Always rendered for a shared cruise: load IS the
          headline on a boat several parties share. */}
      {(rosterCollapsed || isMulti || capacity) && (
        <div
          onClick={rosterCollapsed ? () => onSelectGroup?.(group) : undefined}
          className={`flex items-center gap-x-2 flex-wrap px-2.5 ${pad} border-b border-zinc-100 text-[11px] ${rosterCollapsed ? 'cursor-pointer hover:bg-zinc-50 transition-colors' : ''}`}
        >
          {(rosterCollapsed || isMulti) && (
            <span className="font-medium text-indigo-600">
              {group.bookings.length} part{group.bookings.length === 1 ? 'y' : 'ies'} · {group.totalGuestCount} guest{group.totalGuestCount === 1 ? '' : 's'}
            </span>
          )}
          {capacity && <span className="font-medium text-emerald-700">{capacity.spotsLeft} spots left</span>}
        </div>
      )}

      {/* Each party on board — collapsed away above for a busy shared
          departure; see rosterCollapsed. */}
      {!rosterCollapsed && (
        <div className="divide-y divide-zinc-100">
          {group.bookings.map(b => {
            const cateringItems = filterCateringItems(b.extras_selected ?? [])
            const showStatus = b.status !== 'confirmed' && b.status !== 'booked'
            return (
              // A <div>, not a <button>: the call/WhatsApp buttons below are
              // themselves interactive, and a button can't nest a button.
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectBooking(b.id)}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onSelectBooking(b.id)}
                className={`w-full text-left px-2.5 ${dense ? 'py-1' : 'py-1.5'} text-xs hover:bg-zinc-50 transition-colors cursor-pointer`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-zinc-900 truncate">{b.customer_name ?? '—'}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-zinc-500 tabular-nums whitespace-nowrap">
                      {b.guest_count ?? '—'} guest{b.guest_count !== 1 ? 's' : ''}
                    </span>
                    {/* Icons, never the raw digits — the crew calls and
                        messages through the numbers we already dial from
                        (softphone) and chat from (WhatsApp), not by reading
                        a phone number off the grid and dialling by hand. */}
                    <ContactActions booking={b} onContact={onContact} />
                  </div>
                </div>
                {/* Catering and the guest's own note wrap to two lines rather
                    than ellipsing: "Bites Box Small (1-2 gu…" tells the crew
                    nothing, and these two lines are the whole reason a captain
                    reads the card before the day starts. Full text on hover. */}
                {cateringItems.length > 0 && (
                  <p className="flex items-start gap-1 text-zinc-600" title={cateringItems.map(i => i.name).join(', ')}>
                    <UtensilsCrossed className="w-3 h-3 mt-[3px] shrink-0" />
                    <span className="line-clamp-2">{cateringItems.map(i => i.name).join(', ')}</span>
                  </p>
                )}
                {b.guest_note && (
                  <p className="line-clamp-2 text-zinc-400 italic" title={b.guest_note}>
                    &ldquo;{b.guest_note}&rdquo;
                  </p>
                )}
                {showStatus && (
                  <div className="mt-1 flex items-center gap-1 flex-wrap">
                    <BookingStatusBadge status={b.status} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export type ContactMode = 'call' | 'message'

/** Call and WhatsApp, icon-only — never the raw number, so a busy card doesn't
 *  turn into a phone book. Neither icon acts directly: both open the contact
 *  drawer, which is where the number, the guest's booking and the actual
 *  call/message controls live. `stopPropagation` on both, since they sit
 *  inside a clickable party row that would otherwise also fire. */
function ContactActions({ booking, onContact }: { booking: AdminBooking; onContact: (booking: AdminBooking, mode: ContactMode) => void }) {
  if (!booking.customer_phone || !normalizePhoneE164(booking.customer_phone)) return null
  const open = (mode: ContactMode) => (e: React.MouseEvent) => {
    e.stopPropagation()
    onContact(booking, mode)
  }
  return (
    <span className="flex items-center gap-0.5">
      <button
        type="button"
        title={`Call ${booking.customer_name ?? 'guest'}`}
        onClick={open('call')}
        className="p-1 rounded-md text-teal-700 hover:bg-teal-100 transition-colors"
      >
        <Phone className="w-3 h-3" />
      </button>
      <button
        type="button"
        title={`Message ${booking.customer_name ?? 'guest'}`}
        onClick={open('message')}
        className="p-1 rounded-md text-emerald-700 hover:bg-emerald-100 transition-colors"
      >
        <MessageCircle className="w-3 h-3" />
      </button>
    </span>
  )
}

/**
 * Full-height drawer from the right for reaching one guest — the surface both
 * contact icons open. A drawer rather than a modal because reaching a guest is
 * a task you do WHILE reading the week: the grid stays visible and in place
 * behind it, so you don't lose your position on the board mid-call.
 *
 * Calling goes through the softphone we already run in the admin shell
 * (VoiceProvider), the same one the inbox dials from — the number never has to
 * be read off the screen and typed into a phone.
 */
function ContactDrawer({ booking, mode, onClose }: { booking: AdminBooking; mode: ContactMode; onClose: () => void }) {
  const voice = useVoice()
  const e164 = booking.customer_phone ? normalizePhoneE164(booking.customer_phone) : null
  const inCall = !!voice && voice.state !== 'idle'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside
        className="bg-white w-full max-w-sm h-full shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 truncate">{booking.customer_name ?? 'Guest'}</h2>
            <p className="text-xs text-zinc-400 truncate">
              {timeRangeLabel(booking.start_time, booking.end_time)} · {booking.guest_count ?? '—'} guest{booking.guest_count === 1 ? '' : 's'}
            </p>
            {booking.listing_title && <p className="text-xs text-zinc-400 truncate">{booking.listing_title}</p>}
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 transition-colors shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-zinc-400 mb-1">Phone</p>
            <p className="text-sm text-zinc-900 tabular-nums">{booking.customer_phone}</p>
          </div>

          {/* BOTH ways to reach the guest, always — which icon you clicked only
              decides which one leads. Once the drawer is open you've already
              got the guest in front of you, and "they didn't pick up, message
              them" shouldn't mean closing this and starting again. */}
          {(mode === 'call' ? ['call', 'message'] : ['message', 'call']).map(action =>
            action === 'call' ? (
              <div key="call" className="space-y-2">
                {voice ? (
                  <>
                    <button
                      type="button"
                      disabled={!e164 || inCall}
                      onClick={() => e164 && voice.startCall(e164)}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      <Phone className="w-4 h-4" />
                      {inCall ? 'Call in progress…' : 'Call now'}
                    </button>
                    <p className="text-xs text-zinc-400">
                      {inCall
                        ? 'Answer and hang up on the phone widget in the corner.'
                        : 'Rings through the admin softphone — the same line the inbox calls from.'}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-zinc-500">
                    Calling isn&apos;t set up in this environment, so there&apos;s no line to dial from here.
                  </p>
                )}
              </div>
            ) : (
              <div key="message" className="space-y-2">
                <a
                  href={e164 ? `https://wa.me/${e164.replace('+', '')}` : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  Open in WhatsApp
                </a>
                {/* Honest about which number this comes from — this opens YOUR
                    WhatsApp, not the business inbox thread, so the guest sees a
                    different sender than they would from a reply in the inbox. */}
                <p className="text-xs text-zinc-400">
                  Opens WhatsApp on this device. Replies land in your own WhatsApp, not the shared inbox.
                </p>
              </div>
            ),
          )}
        </div>
      </aside>
    </div>
  )
}

/** Departures of one kind on a day. Counts GROUPS, not bookings — three
 *  parties sharing one sailing is one departure to crew and one slot of water. */
function countDepartures(groups: PlanningGroup[], category: 'shared' | 'private'): number {
  return groups.filter(g => g.bookings[0]?.category === category).length
}

/** The day-name block (Mon / 17 Aug / who's available), used on mobile only —
 *  each day stacks full-width there with nothing to freeze against, so it
 *  sits inside its own day card. The desktop row layout has its own compact
 *  date-rail cell instead (see DayRow) since there's no room here for
 *  wrapped name chips at row height. */
function DayHeader({ label, dateObj, isToday, availableStaff, sharedCount = 0, privateCount = 0, className = '' }: { label: string; dateObj: Date; isToday: boolean; availableStaff: string[]; sharedCount?: number; privateCount?: number; className?: string }) {
  return (
    <div className={`px-3 py-2 border-b ${isToday ? 'border-indigo-200 bg-indigo-50' : 'border-zinc-200 bg-zinc-50'} ${className}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-wider ${isToday ? 'text-indigo-700' : 'text-zinc-500'}`}>
            {label}
          </p>
          <p className={`text-sm font-medium ${isToday ? 'text-indigo-900' : 'text-zinc-900'}`}>
            {dateObj.getDate()} {dateObj.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/Amsterdam' })}
          </p>
        </div>
        {/* The day's shape at a glance: how many DEPARTURES of each kind, not
            how many bookings — several parties sharing one sailing is still
            one trip to crew and one slot of water. */}
        {(sharedCount > 0 || privateCount > 0) && (
          <div className="text-right text-[10px] leading-tight text-zinc-500 shrink-0">
            {privateCount > 0 && (
              <p><span className="font-semibold tabular-nums text-zinc-700">{privateCount}</span> private</p>
            )}
            {sharedCount > 0 && (
              <p><span className="font-semibold tabular-nums text-zinc-700">{sharedCount}</span> shared</p>
            )}
          </div>
        )}
      </div>
      {availableStaff.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {availableStaff.map(name => (
            <span
              key={name}
              title={`${name} — available`}
              className="text-[10px] leading-tight px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium truncate max-w-full"
            >
              {name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Hour gridlines for one time-grid column — a background layer of thin
 * horizontal lines, one per hour from 09:00 to 00:00. Purely decorative
 * (z-0, no pointer events), sits behind the positioned departure blocks.
 */
function GridLines() {
  return (
    <>
      {hourMarks().map(m => (
        <div
          key={m.hour}
          className="absolute left-0 right-0 border-t border-zinc-100"
          style={{ top: m.topPx }}
        />
      ))}
    </>
  )
}

interface CaptainWindow {
  name: string
  startIso: string
  endIso: string
}

/** One working-time span per captain active in this column: from 1h before
 *  their earliest departure that day (crew call) to 45min after their
 *  latest cruise returns (wrap-up) — spans every cruise they're on, not just
 *  the first, so a captain running 3 back-to-back cruises gets one
 *  continuous bar instead of 3 overlapping ones. Two different captains
 *  splitting the same boat/day (one morning, one afternoon) get two
 *  separate, non-overlapping bars. */
function computeCaptainWindows(
  groups: PlanningGroup[],
  captainByBookingId?: Map<string, { name: string; startAt: string; endAt: string }>,
): CaptainWindow[] {
  if (!captainByBookingId) return []
  const byCaptain = new Map<string, { startMs: number; endMs: number }>()
  for (const group of groups) {
    for (const b of group.bookings) {
      const captain = captainByBookingId.get(b.id)
      if (!captain) continue
      const startMs = new Date(captain.startAt).getTime()
      const endMs = new Date(captain.endAt).getTime()
      const existing = byCaptain.get(captain.name)
      if (existing) {
        existing.startMs = Math.min(existing.startMs, startMs)
        existing.endMs = Math.max(existing.endMs, endMs)
      } else {
        byCaptain.set(captain.name, { startMs, endMs })
      }
    }
  }
  return Array.from(byCaptain.entries()).map(([name, { startMs, endMs }]) => ({
    name,
    startIso: new Date(startMs - 60 * 60_000).toISOString(),
    endIso: new Date(endMs + 45 * 60_000).toISOString(),
  }))
}

/**
 * One time-axis column (a whole day when it isn't split by boat, or one boat
 * sub-column when it is). Fixed height spanning the full 09:00–00:00 window;
 * each departure is positioned by its real start AND end time — the block's
 * height is capped at the cruise's actual duration and never grows past its
 * end line, so the grid stays trustworthy at a glance; overflowing content
 * is clipped rather than pushing the box into the next time slot.
 * Hovering brings a block to the front, for the rare case of two departures
 * close enough together to visually overlap.
 *
 * `boatLabel` (when a day is split by boat) renders as an absolutely
 * positioned overlay INSIDE this container rather than a block above it —
 * every column's grid must start at the exact same offset regardless of
 * whether it has a label, or its hours would drift out of sync with the
 * shared hour rail and every other (unlabeled) day column.
 */
function TimeGridColumn({ groups, onSelectBooking, onSelectGroup, onContact, boatLabel, compact = false, sharedCapacity, captainByBookingId }: { groups: PlanningGroup[]; onSelectBooking: (id: string) => void; onSelectGroup?: (group: PlanningGroup) => void; onContact: (booking: AdminBooking, mode: ContactMode) => void; boatLabel?: string; compact?: boolean; sharedCapacity?: Record<number, SharedCapacityResult>; captainByBookingId?: Map<string, { name: string; startAt: string; endAt: string }> }) {
  const captainWindows = useMemo(() => computeCaptainWindows(groups, captainByBookingId), [groups, captainByBookingId])
  return (
    <div className="relative" style={{ height: GRID_HEIGHT_PX }}>
      <GridLines />
      {captainWindows.map(w => (
        <div
          key={w.name}
          className="absolute left-0 right-0 z-[1] bg-emerald-100/70 border-y border-emerald-200 pointer-events-none"
          style={{ top: topPx(w.startIso), height: blockMinHeightPx(w.startIso, w.endIso) }}
          title={`${w.name} working ${fmtAdminTime(w.startIso)}–${fmtAdminTime(w.endIso)}`}
        />
      ))}
      {boatLabel && (
        <p className="absolute top-0.5 left-1 z-20 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-white/90 px-1 rounded pointer-events-none">
          {boatLabel}
        </p>
      )}
      {groups.length === 0 && (
        <p className="absolute inset-0 flex items-center justify-center text-xs text-zinc-300">—</p>
      )}
      {groups.map(group => {
        const first = group.bookings[0]
        const boat = resolveBoatForGroup(group, sharedCapacity)
        return (
          <div
            key={group.key}
            className="absolute left-1 right-1 z-10 hover:z-30"
            // height, never minHeight: a card must stop exactly at the cruise's
            // real end time, or the grid stops being readable as "when is the
            // water free". Room for content comes from the grid's scale
            // (PX_PER_HOUR) instead — see planning-time-grid.ts.
            style={{ top: topPx(first.start_time), height: blockMinHeightPx(first.start_time, first.end_time) }}
          >
            <DepartureBlock
              group={group}
              onSelectBooking={onSelectBooking}
              onSelectGroup={onSelectGroup}
              onContact={onContact}
              dense={compact}
              boatName={boat}
              capacity={first.category === 'shared' && first.fareharbor_availability_pk ? sharedCapacity?.[first.fareharbor_availability_pk] : undefined}
              captainByBookingId={captainByBookingId}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Desktop row layout: dates on the y-axis, time across the top ───────────
//
// The vertical grid above (TimeGridColumn) gives one day a full column
// 09:00–00:00 tall — great for reading one day's detail, expensive when you
// want to scan a whole week: 15 hours * 100px is a lot of scrolling per day.
// This is the same data, rotated 90°: one THIN ROW per day, time flowing
// left-to-right along the top instead of top-to-bottom down the side. A
// departure becomes a small chip (time + guest count + captain status) —
// full detail is one click away in the same booking/group modal the
// vertical cards already open, never lost, just not shown inline.

/** Height of one lane, and of the empty-day placeholder that stands in for
 *  one — a single class so the two can never drift apart. Tall enough for the
 *  chip's two lines of text; the vertical axis is the cheap one in this
 *  layout (a row costs 40px where the old column cost 1500px), so it's the
 *  right place to spend for legibility. */
const ROW_LANE_HEIGHT = 'h-10'

/** Vertical hour gridlines for one row-lane — the row-layout counterpart to
 *  GridLines (which draws horizontal lines for the vertical column layout). */
function RowGridLines() {
  return (
    <>
      {hourMarksRow().map(m => (
        <div key={m.hour} className="absolute top-0 bottom-0 border-l border-zinc-100" style={{ left: m.leftPx }} />
      ))}
    </>
  )
}

/** One departure, compacted to a two-line chip that fits inside a short row:
 *
 *    line 1   start time · who (guest name, or "N parties" on a shared
 *             departure) · guest count
 *    line 2   boat · captain — or "no captain" — plus a catering icon
 *
 *  Everything else that DepartureBlock shows inline (phone/WhatsApp, catering
 *  item names, guest notes) is in the title tooltip on hover and the full
 *  booking/group modal on click, per Beer's call on the compact-chip vs
 *  full-card tradeoff (2026-08-23).
 *
 *  Colour carries ONE meaning here, deliberately: amber fill = nobody is
 *  running this yet, the only thing on the page that needs an action. An
 *  assigned departure is plain white with a thin emerald edge, so a week
 *  that's fully crewed reads as calm and the gaps jump out. (The earlier
 *  version tinted assigned chips emerald too, which made a healthy week look
 *  as loud as a broken one.) */
function CompactDepartureChip({
  group, onSelectBooking, onSelectGroup, capacity,
}: {
  group: PlanningGroup
  onSelectBooking: (id: string) => void
  onSelectGroup: (group: PlanningGroup) => void
  capacity?: SharedCapacityResult
}) {
  const first = group.bookings[0]
  const isMulti = group.bookings.length > 1
  const isShared = first.category === 'shared'
  const hasCatering = group.bookings.some(b => filterCateringItems(b.extras_selected ?? []).length > 0)
  const width = blockMinWidthPx(first.start_time, first.end_time)
  // Anything that isn't a normal confirmed booking — invisible before this
  // and worth surfacing, since it's the one thing about a departure that
  // can't be inferred from where the chip sits on the board.
  const needsAttention = group.bookings.find(b => b.status !== 'confirmed' && b.status !== 'booked')

  const headline = isShared
    ? `${group.bookings.length} part${group.bookings.length === 1 ? 'y' : 'ies'}`
    : (first.customer_name ?? '—')
  // Boat and captain deliberately absent — the shift lane this chip sits in
  // already carries both (Beer, 2026-08-23). Only what the lane can't say.
  const detail = needsAttention?.status
    ? needsAttention.status.replace(/_/g, ' ')
    : (isShared && capacity ? `${capacity.spotsLeft} spots left` : null)

  const tooltip = [
    timeRangeLabel(first.start_time, first.end_time),
    first.category === 'private' ? 'Private' : isShared ? 'Shared' : null,
    isShared
      ? `${group.bookings.length} part${group.bookings.length === 1 ? 'y' : 'ies'} · ${group.totalGuestCount} guest${group.totalGuestCount === 1 ? '' : 's'}${capacity ? ` · ${capacity.spotsLeft} spots left` : ''}`
      : group.bookings.map(b => `${b.customer_name ?? '—'} (${b.guest_count ?? '—'} guests)`).join(', '),
    hasCatering ? 'Catering ordered' : null,
  ].filter(Boolean).join('\n')

  const showDetail = width >= CHIP_DETAIL_MIN_PX && (detail || hasCatering)

  return (
    <button
      type="button"
      onClick={() => (isMulti ? onSelectGroup(group) : onSelectBooking(first.id))}
      title={tooltip}
      style={{ left: leftPx(first.start_time), width }}
      className="absolute top-0.5 bottom-0.5 z-10 hover:z-30 flex flex-col justify-center overflow-hidden rounded-md border border-zinc-300 bg-white pl-1.5 pr-1.5 text-left leading-none whitespace-nowrap shadow-sm transition-colors hover:bg-zinc-50"
    >
      <span className="flex items-baseline gap-1 min-w-0">
        <span className="text-[10px] font-semibold tabular-nums shrink-0 text-zinc-900">
          {fmtAdminTime(first.start_time)}
        </span>
        <span className="text-[10px] truncate min-w-0 text-zinc-600">{headline}</span>
        {group.totalGuestCount > 0 && (
          <span className="text-[9px] tabular-nums shrink-0 ml-auto pl-1 text-zinc-400">
            {group.totalGuestCount}g
          </span>
        )}
      </span>

      {showDetail && (
        <span className="flex items-center gap-1 min-w-0 mt-1">
          <span className={`text-[9px] truncate min-w-0 ${needsAttention ? 'text-amber-700 font-semibold' : 'text-zinc-400'}`}>
            {detail}
          </span>
          {hasCatering && <UtensilsCrossed className="w-2.5 h-2.5 shrink-0 ml-auto text-zinc-400" />}
        </span>
      )}
    </button>
  )
}

/** One lane of chips — a whole day when it isn't split by boat, or one boat's
 *  lane when it is (stacked lanes within the day's row instead of the
 *  vertical layout's side-by-side sub-columns, since a row has no spare
 *  width to spend on a second column). Same fixed-width-spanning-the-full-
 *  grid contract as TimeGridColumn, just on the horizontal axis. */
function ShiftLane({
  shift, boatName, groups, onSelectBooking, onSelectGroup, onAssign, sharedCapacity, nowPx,
}: {
  /** Null for the fallback lane holding departures no shift covers yet. */
  shift: PlanningShift | null
  boatName?: string | null
  groups: PlanningGroup[]
  onSelectBooking: (id: string) => void
  onSelectGroup: (group: PlanningGroup) => void
  onAssign: (shift: PlanningShift) => void
  sharedCapacity?: Record<number, SharedCapacityResult>
  /** Set only on today's lanes — the live "right now" marker. */
  nowPx?: number | null
}) {
  const captain = shift?.staff?.name ?? null
  const label = [boatName, captain].filter(Boolean).join(' · ')

  return (
    <div className={`relative shrink-0 ${ROW_LANE_HEIGHT}`} style={{ width: GRID_WIDTH_PX }}>
      <RowGridLines />

      {/* The shift itself — a captain's block of work on one boat, prep
          through wrap-up. It exists whether or not anyone is on it yet, and
          it is the thing you click to put someone on it. Assigned shifts sit
          back in faint emerald; an open one is amber, because an uncrewed
          boat is the only thing on this page that needs an action. */}
      {shift && (
        <button
          type="button"
          onClick={() => onAssign(shift)}
          title={`${boatName ?? 'Shift'} · ${fmtAdminTime(shift.start_at)}–${fmtAdminTime(shift.end_at)}\n${
            captain ? `Captain: ${captain}` : 'No captain yet'
          }\nClick to ${captain ? 'change' : 'assign'} the captain`}
          style={{ left: leftPx(shift.start_at), width: blockMinWidthPx(shift.start_at, shift.end_at) }}
          className={`absolute inset-y-0 z-[1] flex items-center gap-1 overflow-hidden rounded px-1.5 border text-left transition-colors ${
            captain
              ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
              : 'bg-amber-50 border-amber-300 hover:bg-amber-100'
          }`}
        >
          {captain
            ? <UserCheck className="w-2.5 h-2.5 shrink-0 text-emerald-600" />
            : <UserX className="w-2.5 h-2.5 shrink-0 text-amber-600" />}
          <span className={`text-[9px] font-medium truncate min-w-0 ${captain ? 'text-emerald-800' : 'text-amber-800'}`}>
            {captain ? label : `${boatName ? `${boatName} · ` : ''}assign`}
          </span>
        </button>
      )}

      {nowPx != null && (
        <div className="absolute inset-y-0 z-[2] w-px bg-rose-400 pointer-events-none" style={{ left: nowPx }} />
      )}

      {groups.map(group => {
        const first = group.bookings[0]
        return (
          <CompactDepartureChip
            key={group.key}
            group={group}
            onSelectBooking={onSelectBooking}
            onSelectGroup={onSelectGroup}
            capacity={first.category === 'shared' && first.fareharbor_availability_pk ? sharedCapacity?.[first.fareharbor_availability_pk] : undefined}
          />
        )
      })}
    </div>
  )
}

/** One day, as a row: a compact date cell (sticky left, so it stays readable
 *  however far right the grid scrolls) plus ONE LANE PER SHIFT — a shift
 *  being one boat's block of work for that day, which exists (status 'open')
 *  from the moment the booking→shift sync runs, long before anyone is put on
 *  it. Departures are placed in their own shift's lane via shift_bookings
 *  membership; anything no shift covers falls into a labelled lane of its
 *  own rather than silently vanishing.
 *
 *  The rail shows what you can't get by looking at the lanes: how many
 *  shifts still need a captain, and how many crew said they're free. The
 *  private/shared split DayHeader shows on mobile is deliberately NOT here —
 *  the chips themselves already spell that out, and rail width is the
 *  scarcest space on this layout. Full staff names stay in the tooltip. */
function DayRow({
  label, dateObj, isToday, dayGroups, dayShifts, boatNameById, shiftIdByBookingId, sharedCapacity, availableStaff, onSelectBooking, onSelectGroup, onAssign, nowPx,
}: {
  label: string
  dateObj: Date
  isToday: boolean
  dayGroups: PlanningGroup[]
  dayShifts: PlanningShift[]
  boatNameById: Map<string, string>
  shiftIdByBookingId: Map<string, string>
  sharedCapacity?: Record<number, SharedCapacityResult>
  availableStaff: string[]
  onSelectBooking: (id: string) => void
  onSelectGroup: (group: PlanningGroup) => void
  onAssign: (shift: PlanningShift) => void
  nowPx?: number | null
}) {
  // Every departure lands in exactly one lane: its shift's, or the fallback.
  const { groupsByShift, orphanGroups } = useMemo(() => {
    const byShift = new Map<string, PlanningGroup[]>()
    const orphans: PlanningGroup[] = []
    for (const g of dayGroups) {
      const shiftId = g.bookings.map(b => shiftIdByBookingId.get(b.id)).find(Boolean)
      if (!shiftId) {
        orphans.push(g)
        continue
      }
      const bucket = byShift.get(shiftId)
      if (bucket) bucket.push(g)
      else byShift.set(shiftId, [g])
    }
    return { groupsByShift: byShift, orphanGroups: orphans }
  }, [dayGroups, shiftIdByBookingId])

  const unassigned = dayShifts.filter(s => !s.staff_id).length
  const isWeekend = dateObj.getDay() === 0 || dateObj.getDay() === 6

  const tooltip = [
    `${countDepartures(dayGroups, 'private')} private, ${countDepartures(dayGroups, 'shared')} shared`,
    dayShifts.length === 0
      ? 'No shifts'
      : unassigned > 0
        ? `${unassigned} of ${dayShifts.length} shift${dayShifts.length === 1 ? '' : 's'} still need a captain`
        : 'Every shift has a captain',
    availableStaff.length > 0 ? `Available: ${availableStaff.join(', ')}` : 'Nobody marked available',
  ].join('\n')

  return (
    // py-1.5 + a real (not hairline) border between days — with several
    // stacked shift lanes per day, a plain 1px divider let one day's block
    // blend straight into the next. This is deliberately heavier than the
    // divide-y between LANES inside a day (see the lanes container below),
    // so the two boundaries read as different things at a glance.
    <div className={`flex py-1.5 border-b-4 border-zinc-100 last:border-b-0 ${isToday ? 'bg-indigo-50/40' : isWeekend ? 'bg-zinc-50/60' : ''}`}>
      <div
        className={`sticky left-0 z-20 shrink-0 flex items-center gap-1.5 px-2 border-r ${
          isToday ? 'bg-indigo-50 border-indigo-200' : isWeekend ? 'bg-zinc-50 border-zinc-100' : 'bg-white border-zinc-100'
        }`}
        style={{ width: DATE_RAIL_WIDTH_PX }}
        title={tooltip}
      >
        <div className="shrink-0 text-center w-6">
          <p className={`text-[9px] font-semibold uppercase tracking-wide leading-none ${isToday ? 'text-indigo-600' : 'text-zinc-400'}`}>
            {label}
          </p>
          <p className={`text-sm font-semibold leading-tight ${isToday ? 'text-indigo-900' : 'text-zinc-900'}`}>
            {dateObj.getDate()}
          </p>
        </div>
        <div className="min-w-0 flex flex-col gap-0.5">
          <p className="text-[9px] leading-none text-zinc-400">
            {dateObj.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/Amsterdam' })}
          </p>
          <div className="flex items-center gap-1">
            {unassigned > 0 && (
              <span className="text-[9px] leading-none font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-800 tabular-nums">
                {unassigned}
              </span>
            )}
            {availableStaff.length > 0 && (
              <span className="text-[9px] leading-none font-medium px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 tabular-nums">
                {availableStaff.length}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col divide-y divide-zinc-50">
        {dayShifts.length === 0 && orphanGroups.length === 0 ? (
          <div className={`${ROW_LANE_HEIGHT} relative shrink-0`} style={{ width: GRID_WIDTH_PX }}>
            <RowGridLines />
            {nowPx != null && <div className="absolute inset-y-0 z-[2] w-px bg-rose-400" style={{ left: nowPx }} />}
          </div>
        ) : (
          <>
            {dayShifts.map(shift => (
              <ShiftLane
                key={shift.id}
                shift={shift}
                boatName={shift.boat_id ? boatNameById.get(shift.boat_id) ?? null : null}
                groups={groupsByShift.get(shift.id) ?? []}
                onSelectBooking={onSelectBooking}
                onSelectGroup={onSelectGroup}
                onAssign={onAssign}
                sharedCapacity={sharedCapacity}
                nowPx={nowPx}
              />
            ))}
            {/* Departures the sync hasn't covered with a shift yet — usually a
                booking that landed since the last sync run. Shown rather than
                dropped, so nothing can go missing from the board. */}
            {orphanGroups.length > 0 && (
              <ShiftLane
                shift={null}
                groups={orphanGroups}
                onSelectBooking={onSelectBooking}
                onSelectGroup={onSelectGroup}
                onAssign={onAssign}
                sharedCapacity={sharedCapacity}
                nowPx={nowPx}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Put a captain on a shift (or take one off), straight from the board.
 *
 * A modal rather than a popover anchored to the shift bar: the row strip is
 * an `overflow-x-auto` scrollport, so anything absolutely positioned inside
 * it gets clipped at the lane's edges — exactly where a dropdown needs to
 * escape to.
 *
 * Crew who marked themselves available for that date are listed first and
 * flagged; the rest stay pickable, because "nobody marked available" is a
 * reason to ring round, not a reason the UI should refuse to assign.
 *
 * Saving hits PUT /api/admin/scheduling/shifts/[id], which DMs the captain
 * immediately. That's deliberate and matches applyScheduleAssignments' own
 * rule: a human clicking assign IS the confirm moment (only the automatic
 * scheduler defers the DM, since its picks stay provisional as more bookings
 * land).
 */
function AssignCaptainModal({
  shift, boatName, staff, availableIds, onClose, onSaved,
}: {
  shift: PlanningShift
  boatName: string | null
  staff: { id: string; name: string }[]
  availableIds: Set<string>
  onClose: () => void
  onSaved: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ordered = useMemo(() => {
    return [...staff].sort((a, b) => {
      const aFree = availableIds.has(a.id) ? 0 : 1
      const bFree = availableIds.has(b.id) ? 0 : 1
      return aFree - bFree || a.name.localeCompare(b.name)
    })
  }, [staff, availableIds])

  async function assign(staffId: string | null) {
    setBusyId(staffId ?? 'clear')
    setError(null)
    try {
      await adminMutate(`/api/admin/scheduling/shifts/${shift.id}`, 'PUT', { staff_id: staffId })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900">
              {shift.staff ? 'Change captain' : 'Assign a captain'}
            </h2>
            <p className="text-xs text-zinc-400 truncate">
              {[boatName, `${fmtAdminTime(shift.start_at)}–${fmtAdminTime(shift.end_at)}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 shrink-0" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && <p className="px-5 pt-3 text-xs text-red-600">{error}</p>}

        <div className="flex-1 overflow-y-auto p-2">
          {ordered.length === 0 && <p className="p-3 text-sm text-zinc-400">No active crew.</p>}
          {ordered.map(s => {
            const isCurrent = s.id === shift.staff_id
            const isFree = availableIds.has(s.id)
            return (
              <button
                key={s.id}
                onClick={() => assign(s.id)}
                disabled={!!busyId || isCurrent}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors disabled:opacity-60 ${
                  isCurrent ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-zinc-50 text-zinc-800'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isFree ? 'bg-emerald-500' : 'bg-zinc-300'}`} />
                <span className="truncate">{s.name}</span>
                {busyId === s.id && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto shrink-0" />}
                {isCurrent && busyId !== s.id && <span className="ml-auto text-[10px] font-medium shrink-0">on this shift</span>}
                {!isCurrent && isFree && busyId !== s.id && (
                  <span className="ml-auto text-[10px] text-emerald-600 shrink-0">available</span>
                )}
              </button>
            )
          })}
        </div>

        {shift.staff_id && (
          <div className="px-5 py-3 border-t border-zinc-100">
            <button
              onClick={() => assign(null)}
              disabled={!!busyId}
              className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              {busyId === 'clear' && <Loader2 className="w-3 h-3 animate-spin" />}
              Take {shift.staff?.name ?? 'them'} off this shift
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PlanningPage() {
  const params = useParams()
  const locale = params.locale as string
  const router = useRouter()
  const { data: bookings, isLoading: loading, error, refresh: fetchBookings } =
    useAdminFetch<AdminBooking[]>('/api/admin/bookings/local')
  // Event-based, not polling — see notify-bookings-changed.ts for every trigger point.
  useBookingsChangedSignal(fetchBookings)

  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  // How many weeks of days to show at once — the compact row layout (one
  // thin row per day, not a full 1500px column) is what makes showing more
  // than a single week actually usable on screen. Prev/Today/Next all step
  // by this same span, so paging never re-shows a day you just saw.
  const [weekCount, setWeekCount] = useState(2)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // A shared departure's own summary modal — one level up from a single
  // booking's detail. Stores the booking ids at click time (not the
  // PlanningGroup object itself) so the list stays correct across a refetch
  // instead of holding a stale group reference.
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[] | null>(null)
  // Which guest the contact drawer is open for, and whether it opened to call
  // or to message. One piece of state for both — only ever one guest at a time.
  const [contactTarget, setContactTarget] = useState<{ booking: AdminBooking; mode: ContactMode } | null>(null)
  const openContact = (booking: AdminBooking, mode: ContactMode) => setContactTarget({ booking, mode })
  // Which shift the assign-a-captain modal is open for.
  const [assignShift, setAssignShift] = useState<PlanningShift | null>(null)

  // The frozen day-name strip and the hours below it are two separate
  // horizontal scrollers (see the grid comment), so their scrollLeft has to be
  // mirrored or the day names would drift out of line with their columns.
  // Assigning scrollLeft fires the other one's onScroll, so guard against the
  // resulting ping-pong by only writing when the value actually differs.
  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  function syncScroll(from: React.RefObject<HTMLDivElement | null>, to: React.RefObject<HTMLDivElement | null>) {
    if (!from.current || !to.current) return
    if (to.current.scrollLeft !== from.current.scrollLeft) to.current.scrollLeft = from.current.scrollLeft
  }
  const [showGhostActivity, setShowGhostActivity] = useState(false)
  const [findingCaptains, setFindingCaptains] = useState(false)
  const [findCaptainsResult, setFindCaptainsResult] = useState<string | null>(null)
  const selectedBooking = bookings?.find(b => b.id === expandedId) ?? null
  const expandedGroupBookings = expandedGroupIds
    ? (bookings ?? []).filter(b => expandedGroupIds.includes(b.id))
    : null

  const todayStr = useMemo(() => amsDateString(new Date()), [])
  // Live "right now" marker on today's row. A minute of drift is invisible at
  // ~1px per minute, so a 60s tick is plenty — and it's a pure clock, no
  // refetch involved. Null outside the grid's 09:00–00:00 window.
  const nowTick = useTickingClock(true, 60_000)
  const nowPx = useMemo(() => nowLeftPx(nowTick), [nowTick])
  const days = useMemo(() => weekDateStrings(weekStart, weekCount * 7), [weekStart, weekCount])

  // Group bookings by booking_date, then within each day collapse same-slot
  // bookings (same time + listing + category + customer type) into one block —
  // a shared cruise sold to several separate parties is one departure, not N
  // unrelated cards. Each day's groups sorted by start_time (also the sort
  // order the time-grid positions them in, top to bottom).
  const byDay = useMemo(() => {
    const map = new Map<string, AdminBooking[]>()
    for (const day of days) map.set(day, [])
    for (const b of bookings ?? []) {
      if (!b.booking_date) continue
      const bucket = map.get(b.booking_date)
      if (bucket) bucket.push(b)
    }
    const grouped = new Map<string, PlanningGroup[]>()
    for (const [day, dayBookings] of map) {
      const groups = groupBookingsForPlanning(dayBookings)
      groups.sort((a, b) => (a.bookings[0].start_time ?? '').localeCompare(b.bookings[0].start_time ?? ''))
      grouped.set(day, groups)
    }
    return grouped
  }, [bookings, days])

  const weekTotal = days.reduce(
    (sum, d) => sum + (byDay.get(d)?.reduce((s, g) => s + g.bookings.length, 0) ?? 0),
    0,
  )

  // Live FareHarbor capacity for shared-cruise departures — FareHarbor never
  // stores this on the booking itself, only the availability endpoint has it,
  // so it's a separate fetch keyed off the FH availability PKs visible this
  // week. Aggregate guests-already-booked PER PK first (two virtual-product
  // listings can share one physical FH availability), so the boat guess uses
  // the slot's true total, not just one listing's slice of it.
  const sharedSlotsUrl = useMemo(() => {
    const byPk = new Map<number, number>()
    for (const groups of byDay.values()) {
      for (const group of groups) {
        const first = group.bookings[0]
        if (first.category !== 'shared' || !first.fareharbor_availability_pk) continue
        const pk = first.fareharbor_availability_pk
        byPk.set(pk, (byPk.get(pk) ?? 0) + group.totalGuestCount)
      }
    }
    if (byPk.size === 0) return null
    const slots = Array.from(byPk.entries()).map(([pk, guests]) => `${pk}:${guests}`).join(',')
    return `/api/admin/planning/shared-capacity?slots=${encodeURIComponent(slots)}`
  }, [byDay])

  const { data: sharedCapacity } = useAdminFetch<Record<number, SharedCapacityResult>>(sharedSlotsUrl)

  // Same source and derivation the Scheduling tab's "Available" row uses
  // (ShiftsTab.tsx) — reused as-is rather than duplicated, so both pages
  // stay in sync automatically if the availability model ever changes.
  const { data: staffData, refresh: refreshStaffData } = useAdminFetch<{
    staff: { id: string; name: string }[]
    boats: { id: string; name: string }[]
    availability: { staff_id: string; date: string; status: string }[]
    shifts: PlanningShift[]
  }>(`/api/admin/scheduling/shifts?from=${days[0]}&to=${days[days.length - 1]}`)

  const boatNameById = useMemo(
    () => new Map((staffData?.boats ?? []).map(b => [b.id, b.name])),
    [staffData],
  )

  /**
   * The day's real shifts — the object the row layout is actually built on.
   * A shift is a captain's block of WORK on one boat (prep → cruises →
   * wrap-up, "one boat, one day, one shift" per generate-shifts.ts), created
   * automatically by the booking→shift sync with status 'open' and no captain
   * yet. That's the point: an unassigned departure still HAS a shift, which
   * is what you click to put someone on it.
   *
   * Cancelled shifts are dropped — the sync cancels rather than deletes them
   * (append-only), so they'd otherwise linger as empty lanes forever.
   */
  const shiftsByDate = useMemo(() => {
    const map = new Map<string, PlanningShift[]>()
    for (const s of staffData?.shifts ?? []) {
      if (s.status === 'cancelled') continue
      const bucket = map.get(s.date)
      if (bucket) bucket.push(s)
      else map.set(s.date, [s])
    }
    for (const list of map.values()) list.sort((a, b) => a.start_at.localeCompare(b.start_at))
    return map
  }, [staffData])

  /**
   * Which shift covers a given booking. shift_bookings is the real membership
   * (see 127_shift_bookings.sql, whose index comment names this exact
   * lookup); the single booking_id column and the fareharbor_availability_pk
   * are only the block's PRIMARY departure, kept here as fallbacks so a row
   * that predates the membership backfill still lands in the right lane.
   */
  const shiftIdByBookingId = useMemo(() => {
    const map = new Map<string, string>()
    const byAvailabilityPk = new Map<number, string>()
    for (const s of staffData?.shifts ?? []) {
      if (s.status === 'cancelled') continue
      for (const m of s.shift_bookings ?? []) map.set(m.booking_id, s.id)
      if (s.booking_id && !map.has(s.booking_id)) map.set(s.booking_id, s.id)
      if (s.fareharbor_availability_pk) byAvailabilityPk.set(s.fareharbor_availability_pk, s.id)
    }
    for (const b of bookings ?? []) {
      if (map.has(b.id)) continue
      const viaPk = b.fareharbor_availability_pk ? byAvailabilityPk.get(b.fareharbor_availability_pk) : undefined
      if (viaPk) map.set(b.id, viaPk)
    }
    return map
  }, [staffData, bookings])

  const availableStaffByDate = useMemo(() => {
    const statusByKey = new Map<string, string>()
    for (const a of staffData?.availability ?? []) statusByKey.set(`${a.staff_id}:${a.date}`, a.status)
    const map: Record<string, string[]> = {}
    for (const s of staffData?.staff ?? []) {
      for (const d of days) {
        if (statusByKey.get(`${s.id}:${d}`) === 'available') (map[d] ??= []).push(s.name)
      }
    }
    return map
  }, [staffData, days])

  // Overlay data for the tour blocks: which captain is on a given booking's
  // shift, and their crew-call time (1h before departure — the same "arrive
  // by" moment notifyShiftAssigned DMs them). Only assigned shifts (a real
  // staff_id) produce a badge — an open shift shows nothing, same as today.
  //
  // A shared cruise's shift is never linked to one specific booking_id (several
  // parties can share the same departure slot, so there's no single "the"
  // booking) — generate-shifts.ts links it by fareharbor_availability_pk
  // instead, leaving booking_id null. Match on that as a fallback, or a
  // shared-cruise assignment silently never shows an overlay at all.
  const captainByBookingId = useMemo(() => {
    const map = new Map<string, { name: string; startAt: string; endAt: string }>()
    const byAvailabilityPk = new Map<number, { name: string; startAt: string; endAt: string }>()
    for (const s of staffData?.shifts ?? []) {
      if (!s.staff_id || !s.staff) continue
      const captain = { name: s.staff.name, startAt: s.start_at, endAt: s.end_at }
      if (s.booking_id) map.set(s.booking_id, captain)
      if (s.fareharbor_availability_pk) byAvailabilityPk.set(s.fareharbor_availability_pk, captain)
    }
    for (const b of bookings ?? []) {
      if (map.has(b.id)) continue
      const captain = b.fareharbor_availability_pk ? byAvailabilityPk.get(b.fareharbor_availability_pk) : undefined
      if (captain) map.set(b.id, captain)
    }
    return map
  }, [staffData, bookings])

  // Captains the proactive scheduler has actually assigned this week (auto
  // autonomy, no human click) — see docs/plans/2026-08-06 scheduling plan.
  const { data: ghostActivity, isLoading: ghostActivityLoading, refresh: refreshGhostActivity } = useAdminFetch<GhostActivityItem[]>(
    `/api/admin/planning/ghost-activity?from=${days[0]}&to=${days[days.length - 1]}`,
  )

  // On-demand version of the nightly proactive-scheduling cron — "check
  // right now" instead of waiting for 15:00 UTC. Never DMs a captain by
  // itself (assign-now/notify-later); it only fills in who's assigned,
  // visible immediately via the overlay + Ghost Activity panel refresh.
  async function findCaptains() {
    setFindingCaptains(true)
    setFindCaptainsResult(null)
    try {
      const { summary } = await adminMutate<{ summary: { assigned: number; drafted: number; skipped: number } }>(
        '/api/admin/planning/find-captains',
        'POST',
      )
      setFindCaptainsResult(
        summary.assigned || summary.drafted
          ? `Assigned ${summary.assigned} shift${summary.assigned === 1 ? '' : 's'}${summary.drafted ? `, left ${summary.drafted} for review` : ''}.`
          : 'Nothing to assign — every open shift already has a captain or nobody is confidently available.',
      )
      refreshGhostActivity()
      refreshStaffData()
    } catch (err) {
      setFindCaptainsResult(err instanceof Error ? err.message : 'Could not run the check — try again.')
    } finally {
      setFindingCaptains(false)
    }
  }

  return (
    <div className="p-8 max-w-none space-y-6">
      {/* Header */}
      <div className="shrink-0 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Planning</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {weekCount === 1 ? 'Week view' : `${weekCount}-week view`} · {weekTotal} booking{weekTotal !== 1 ? 's' : ''} shown
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={findCaptains} disabled={findingCaptains}>
            {findingCaptains ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
            {findingCaptains ? 'Checking…' : 'Find captains'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowGhostActivity(true)} className="relative">
            <Ghost className="w-3.5 h-3.5" />
            Ghost activity
            {(ghostActivity?.length ?? 0) > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-violet-600 text-white text-[10px] font-semibold flex items-center justify-center">
                {ghostActivity!.length}
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={() => router.push(`/${locale}/admin/bookings`)}>
            <List className="w-3.5 h-3.5" />
            List view
          </Button>
          <Button variant="outline" size="sm" onClick={fetchBookings} disabled={loading}>
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={() => router.push(`/${locale}/admin/fareharbor`)}>
            <Plus className="w-3.5 h-3.5" />
            New booking
          </Button>
        </div>
      </div>

      <div className="shrink-0"><AdminErrorBanner error={error} /></div>

      {findCaptainsResult && (
        <div className="shrink-0 flex items-center justify-between gap-3 text-sm text-zinc-700 bg-zinc-50 border border-zinc-200 rounded-lg px-4 py-2.5">
          <span>{findCaptainsResult}</span>
          <button onClick={() => setFindCaptainsResult(null)} className="text-zinc-400 hover:text-zinc-600 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Week navigation */}
      <div className="shrink-0 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setWeekStart(w => addDays(w, -weekCount * 7))}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 transition-colors"
            aria-label="Previous"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setWeekStart(getWeekStart(new Date()))}
            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => setWeekStart(w => addDays(w, weekCount * 7))}
            className="p-1.5 rounded-lg text-zinc-500 hover:bg-zinc-100 transition-colors"
            aria-label="Next"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {/* How many weeks to show at once — only worth offering on the
              compact desktop row layout; on mobile each day is still a full
              card, so more weeks just means more scrolling, not more useful
              at-a-glance range. */}
          <div className="hidden lg:flex items-center gap-0.5 ml-1 p-0.5 rounded-lg bg-zinc-100">
            {[1, 2, 4].map(n => (
              <button
                key={n}
                onClick={() => setWeekCount(n)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  weekCount === n ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {n}w
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm font-medium text-zinc-700">{formatWeekRangeLabel(weekStart, weekCount * 7)}</p>
      </div>

      {/* Loading */}
      {loading && !bookings && (
        <div className="shrink-0 flex items-center gap-2 text-sm text-zinc-400 py-8">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading bookings…
        </div>
      )}

      {/* Mobile — each day stacks full-width, its own header, time flowing
          top-to-bottom (unchanged from before the desktop row layout below;
          a horizontal Gantt bar would be unreadably thin on a phone screen).
          Always just the first week regardless of the desktop-only week-count
          selector above — more weeks there means more useful rows on screen,
          but on mobile it would only mean more full-height cards to scroll
          past, which isn't the same win. */}
      {bookings && (
        <div className="lg:hidden flex flex-col gap-3">
          {days.slice(0, 7).map((day, i) => {
            const dayGroups = byDay.get(day) ?? []
            const boatColumns = splitGroupsByBoat(dayGroups, sharedCapacity)
            const isToday = day === todayStr
            const isSplit = boatColumns.length > 1
            return (
              <div
                key={day}
                className={`rounded-lg border flex flex-col w-full ${isToday ? 'border-indigo-300 bg-indigo-50/30' : 'border-zinc-200 bg-white'}`}
              >
                <DayHeader
                  label={DAY_LABELS[i]}
                  dateObj={new Date(day + 'T12:00:00')}
                  isToday={isToday}
                  availableStaff={availableStaffByDate[day] ?? []}
                  sharedCount={countDepartures(dayGroups, 'shared')}
                  privateCount={countDepartures(dayGroups, 'private')}
                  className="rounded-t-lg"
                />
                <div className="p-2 flex gap-2">
                  <div className="w-10 shrink-0">
                    <div className="relative" style={{ height: GRID_HEIGHT_PX }}>
                      {hourMarks().map(m => (
                        // Fixed height + flex-centered content, not line-height-based
                        // text centering: `-translate-y-1/2` shifts by half of
                        // WHATEVER the box renders at, and a 10px font's default
                        // 1.5 line-height renders a 15px box — so the glyph itself
                        // sits 7.5px above the gridline it's meant to label.
                        <div
                          key={m.hour}
                          className="absolute right-0 flex items-center justify-end text-[10px] text-zinc-400 -translate-y-1/2"
                          style={{ top: m.topPx, width: RAIL_WIDTH_PX, height: 12 }}
                        >
                          {m.label}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {!isSplit && (
                      <TimeGridColumn groups={dayGroups} onSelectBooking={setExpandedId} onSelectGroup={group => setExpandedGroupIds(group.bookings.map(b => b.id))} onContact={openContact} sharedCapacity={sharedCapacity} captainByBookingId={captainByBookingId} />
                    )}
                    {isSplit && (
                      <div className="flex gap-2 divide-x divide-zinc-100">
                        {boatColumns.map(col => (
                          <div key={col.boat} className="flex-1 min-w-0 pl-2 first:pl-0">
                            <TimeGridColumn groups={col.groups} onSelectBooking={setExpandedId} onSelectGroup={group => setExpandedGroupIds(group.bookings.map(b => b.id))} onContact={openContact} boatLabel={col.boat} compact sharedCapacity={sharedCapacity} captainByBookingId={captainByBookingId} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Desktop — dates down the side, time across the top. One thin row per
          day instead of a 1500px-tall column, so a full week fits without
          scrolling vertically through empty hours. The hour header and the
          day rows are two separate horizontally-scrolling strips whose
          scrollLeft mirror each other (same reason as the old day-name
          strip did: a single box can't scroll sideways AND let something
          inside it stick to the page, since overflow-x:auto makes that box
          its own scrollport for both axes). */}
      {bookings && (
        <div className="hidden lg:block">
          <div
            ref={headerScrollRef}
            onScroll={() => syncScroll(headerScrollRef, bodyScrollRef)}
            className="flex sticky top-0 z-30 -mx-8 px-8 pt-2 pb-1 bg-zinc-50 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* Matches the date rail's width below so the columns align. */}
            <div className="shrink-0" style={{ width: DATE_RAIL_WIDTH_PX }} aria-hidden="true" />
            <div className="relative h-5 shrink-0" style={{ width: GRID_WIDTH_PX }}>
              {/* Labels sit at the START of the hour they name and are dropped
                  for the final 00:00 edge — the old centred version pushed
                  09:00 half outside the scrollport (translate -50% at left 0)
                  and 00:00 past the right edge, so both end labels clipped. */}
              {hourMarksRow().slice(0, -1).map(m => (
                <span
                  key={m.hour}
                  className="absolute top-0 pl-1 text-[10px] tabular-nums text-zinc-400 border-l border-zinc-200 leading-none py-0.5"
                  style={{ left: m.leftPx }}
                >
                  {m.label}
                </span>
              ))}
              {nowPx != null && (
                <span
                  className="absolute -top-0.5 z-10 -translate-x-1/2 px-1 py-px rounded text-[9px] font-semibold tabular-nums bg-rose-500 text-white"
                  style={{ left: nowPx }}
                >
                  {fmtAdminTime(new Date(nowTick).toISOString())}
                </span>
              )}
            </div>
          </div>

          <div
            ref={bodyScrollRef}
            onScroll={() => syncScroll(bodyScrollRef, headerScrollRef)}
            // Each DayRow draws its own (heavier) bottom border now — a
            // container-level divide-y here would double up with it.
            className="overflow-x-auto border border-zinc-200 rounded-lg bg-white"
          >
            {days.map((day, i) => (
              <DayRow
                key={day}
                // weekStart is always a Monday (getWeekStart) and `days` is
                // always a whole number of 7-day blocks from there, so `i %
                // 7` cycles Mon..Sun correctly even past the first week.
                label={DAY_LABELS[i % 7]}
                dateObj={new Date(day + 'T12:00:00')}
                isToday={day === todayStr}
                dayGroups={byDay.get(day) ?? []}
                dayShifts={shiftsByDate.get(day) ?? []}
                boatNameById={boatNameById}
                shiftIdByBookingId={shiftIdByBookingId}
                sharedCapacity={sharedCapacity}
                availableStaff={availableStaffByDate[day] ?? []}
                onSelectBooking={setExpandedId}
                onSelectGroup={group => setExpandedGroupIds(group.bookings.map(b => b.id))}
                onAssign={setAssignShift}
                nowPx={day === todayStr ? nowPx : null}
              />
            ))}
          </div>
        </div>
      )}

      {/* Shared-departure summary modal — clicking a "3 bookings" card header
          opens this first (a quick "who's on this trip" list) rather than
          jumping straight into one arbitrary booking's full detail. Each row
          opens the same single-booking modal below. */}
      {expandedGroupBookings && expandedGroupBookings.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setExpandedGroupIds(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  {timeRangeLabel(expandedGroupBookings[0].start_time, expandedGroupBookings[0].end_time)}
                </h2>
                <p className="text-xs text-zinc-400">
                  {expandedGroupBookings.length} bookings · {expandedGroupBookings.reduce((sum, b) => sum + (b.guest_count ?? 0), 0)} guests total
                </p>
              </div>
              <button
                onClick={() => setExpandedGroupIds(null)}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto divide-y divide-zinc-100">
              {expandedGroupBookings.map(b => (
                // A <div>, not a <button> — the contact icons are themselves
                // buttons, and a button can't nest one.
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setExpandedGroupIds(null)
                    setExpandedId(b.id)
                  }}
                  onKeyDown={e => {
                    if (e.key !== 'Enter' && e.key !== ' ') return
                    setExpandedGroupIds(null)
                    setExpandedId(b.id)
                  }}
                  className="w-full text-left px-5 py-3 hover:bg-zinc-50 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-900 truncate">
                      {b.customer_name ?? '—'} · {b.guest_count ?? '—'} guest{b.guest_count !== 1 ? 's' : ''}
                    </p>
                    <p className="text-xs text-zinc-400 truncate">
                      {b.booking_source ?? 'website'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Reaching a specific party is the main reason to open
                        this list at all on a shared departure. */}
                    <ContactActions booking={b} onContact={openContact} />
                    <BookingStatusBadge status={b.status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Contact drawer — call or WhatsApp one guest without losing your place
          on the board. Rendered last so it layers over the group modal it can
          be opened from. */}
      {contactTarget && (
        <ContactDrawer
          booking={contactTarget.booking}
          mode={contactTarget.mode}
          onClose={() => setContactTarget(null)}
        />
      )}

      {assignShift && (
        <AssignCaptainModal
          shift={assignShift}
          boatName={assignShift.boat_id ? boatNameById.get(assignShift.boat_id) ?? null : null}
          staff={staffData?.staff ?? []}
          availableIds={
            new Set(
              (staffData?.availability ?? [])
                .filter(a => a.date === assignShift.date && a.status === 'available')
                .map(a => a.staff_id),
            )
          }
          onClose={() => setAssignShift(null)}
          onSaved={() => {
            refreshStaffData()
            refreshGhostActivity()
          }}
        />
      )}

      {/* Detail modal — BookingDetailRow is a wide, multi-column layout built for a
          full-width table row; it doesn't fit inline inside a ~250px day column, so
          it opens here instead rather than squeezing (and overlapping) in place. */}
      {selectedBooking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setExpandedId(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">
                  {selectedBooking.customer_name ?? 'Booking detail'}
                </h2>
                <p className="text-xs text-zinc-400">
                  {selectedBooking.listing_title ?? selectedBooking.tour_item_name} · {timeRangeLabel(selectedBooking.start_time, selectedBooking.end_time)}
                </p>
              </div>
              <button
                onClick={() => setExpandedId(null)}
                className="text-zinc-400 hover:text-zinc-600 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <BookingDetailRow
                bookingId={selectedBooking.id}
                bookingUuid={selectedBooking.booking_uuid}
                listingId={selectedBooking.listing_id}
                status={selectedBooking.status}
                stripePaymentIntentId={selectedBooking.stripe_payment_intent_id}
                bookingDate={selectedBooking.booking_date}
                startTime={selectedBooking.start_time}
                listingTitle={selectedBooking.listing_title}
                onRefresh={fetchBookings}
                customerName={selectedBooking.customer_name}
                customerEmail={selectedBooking.customer_email}
                customerPhone={selectedBooking.customer_phone}
                guestNote={selectedBooking.guest_note}
                guestCount={selectedBooking.guest_count}
                baseAmountCents={selectedBooking.base_amount_cents}
                extrasAmountCents={selectedBooking.extras_amount_cents}
                totalVatAmountCents={selectedBooking.total_vat_amount_cents}
                stripeAmount={selectedBooking.stripe_amount}
                depositAmountCents={selectedBooking.deposit_amount_cents}
                extrasSelected={selectedBooking.extras_selected}
                bookingSource={selectedBooking.booking_source}
                campaignName={selectedBooking.campaign_name}
                promoCode={selectedBooking.promo_code}
                discountAmountCents={selectedBooking.discount_amount_cents}
                partnerName={selectedBooking.partner_name}
                category={selectedBooking.category}
                customerTypeName={selectedBooking.customer_type_name}
                trafficSource={selectedBooking.traffic_source}
                trafficDetail={selectedBooking.traffic_detail}
              />
            </div>
          </div>
        </div>
      )}

      {showGhostActivity && (
        <GhostActivityPanel
          items={ghostActivity ?? []}
          isLoading={ghostActivityLoading}
          weekLabel={formatWeekRangeLabel(weekStart)}
          onClose={() => setShowGhostActivity(false)}
          onConfirmed={refreshGhostActivity}
        />
      )}
    </div>
  )
}
