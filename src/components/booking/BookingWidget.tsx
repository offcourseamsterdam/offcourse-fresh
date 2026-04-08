'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { SearchBar } from '@/components/search/SearchBar'
import type { AvailabilitySlot } from '@/types'

interface BookingWidgetProps {
  listingSlug: string
  initialDate?: string
  initialGuests?: number
}

export function BookingWidget({ listingSlug, initialDate = '', initialGuests = 2 }: BookingWidgetProps) {
  const t = useTranslations('booking')

  const [date, setDate] = useState(initialDate)
  const [guests, setGuests] = useState(initialGuests)
  const [slots, setSlots] = useState<AvailabilitySlot[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(!!initialDate)
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null)

  async function handleSearch(d: string, g: number) {
    setDate(d)
    setGuests(g)
    setLoading(true)
    setSearched(true)
    setSelectedSlot(null)

    try {
      const params = new URLSearchParams({ date: d, guests: String(g), slug: listingSlug })
      const res = await fetch(`/api/search/slots?${params}`)
      const json = await res.json()
      setSlots(json.data?.slots ?? [])
    } catch {
      setSlots([])
    } finally {
      setLoading(false)
    }
  }

  // Auto-search when arriving from homepage search (date pre-filled in URL)
  useEffect(() => {
    if (initialDate) {
      handleSearch(initialDate, initialGuests)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 space-y-6">
      <h3 className="font-bold text-[var(--color-primary)] text-lg">{t('selectDate')}</h3>

      <SearchBar
        onSearch={handleSearch}
        initialDate={date}
        initialGuests={guests}
        loading={loading}
      />

      {searched && !loading && (
        <div>
          <h4 className="font-semibold text-[var(--color-primary)] text-sm mb-3">
            {t('availableSlots')}
          </h4>

          {slots.length === 0 ? (
            <p className="text-sm text-[var(--color-muted)]">{t('noSlotsAvailable')}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {slots.map(slot => (
                <button
                  key={slot.pk}
                  onClick={() => setSelectedSlot(slot)}
                  className={`text-sm font-medium py-2 px-3 rounded-xl border-2 transition-all ${
                    selectedSlot?.pk === slot.pk
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                      : 'border-gray-200 text-[var(--color-foreground)] hover:border-[var(--color-primary)]'
                  }`}
                >
                  {slot.startTime}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedSlot && (
        <Button
          size="lg"
          className="w-full"
          onClick={() => {
            // Track D (Stripe checkout) hooks in here
            const params = new URLSearchParams({
              slot: String(selectedSlot.pk),
              date,
              guests: String(guests),
            })
            window.location.href = `/book/${listingSlug}/checkout?${params}`
          }}
        >
          {t('proceedToCheckout')}
        </Button>
      )}
    </div>
  )
}
