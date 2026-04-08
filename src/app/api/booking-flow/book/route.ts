// Public booking endpoint — re-exports the admin booking logic.
// The admin version handles FareHarbor validation, booking creation,
// Supabase save, Slack notification, and confirmation email.
// No auth is needed for public bookings — Stripe payment confirmation
// serves as the authorization gate.
export { POST } from '@/app/api/admin/booking-flow/book/route'
