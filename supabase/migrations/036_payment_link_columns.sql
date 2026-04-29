-- supabase/migrations/036_payment_link_columns.sql
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_link_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_reminder_sent boolean DEFAULT false;
