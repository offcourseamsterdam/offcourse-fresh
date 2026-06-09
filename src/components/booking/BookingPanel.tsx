'use client'

import { BookingPanelSlider } from './BookingPanelSlider'
import { BookingPanelDesktop } from './BookingPanelDesktop'
import type { BookingPanelProps } from './booking-state'

export type { BookingPanelProps } from './booking-state'

export function BookingPanel(props: BookingPanelProps) {
  // Mobile inline flow: swiping panel-by-panel.
  if (props.layout === 'inline') return <BookingPanelSlider {...props} />
  // Desktop sidebar: Booking.com-style one-screen layout.
  return <BookingPanelDesktop {...props} />
}
