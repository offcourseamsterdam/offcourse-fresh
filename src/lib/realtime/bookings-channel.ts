/**
 * Shared between the server-side sender (notify-bookings-changed.ts) and the
 * client-side subscriber (useBookingsChangedSignal.ts) so they can't drift.
 * No secrets here — safe to import from client code.
 */
export const BOOKINGS_CHANGED_CHANNEL = 'admin-bookings'
export const BOOKINGS_CHANGED_EVENT = 'bookings_changed'
