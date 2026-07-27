-- Barqo turns out to have the same gross/net commission split as BoatLocal,
-- not a single undifferentiated price. Cross-referencing Beer's own bank
-- ledger ("Opzet tussenrekeningen 2025-2026") found a real payout line —
-- "STRIPE Payment from Stripe BARQO PAYMENTS", 2025-07-16, EUR 249.00 — that
-- lines up with Sabine's 2025-07-13 booking (price_cents 30000 / EUR 300.00
-- gross). The EUR 51.00 gap is Barqo's own commission, itself carrying 21%
-- VAT (the same "commission incl. VAT" shape BoatLocal/Withlocals use, kept
-- as deductible input VAT, never netted into "owed"). Beer confirmed: 9%
-- output VAT is derived from the NET payout (matching Click & Boat/
-- GetYourGuide/Viator/GetMyBoat's net-basis convention), not the gross price
-- — the migration 098 comment claiming "no gross/net split visible" was
-- wrong, corrected here.
--
-- Nullable because the second known booking (Frank, 2025-06-26) predates
-- this bank ledger's coverage (which starts 2025-07-01) — its real payout
-- hasn't been confirmed yet. Until it is, the aggregator falls back to
-- treating price_cents as its own net (same as the old behaviour), so
-- existing figures don't silently change for a booking we can't yet verify.
alter table barqo_bookings add column if not exists net_payout_cents integer;

comment on column barqo_bookings.price_cents is 'Gross tour price shown on the Barqo dashboard (what the guest paid) — no longer the sole VAT base, see net_payout_cents.';
comment on column barqo_bookings.net_payout_cents is 'What Barqo actually pays out (confirmed against the bank ledger) — the VAT base for the 9% output VAT. price_cents minus this is Barqo''s commission, incl. 21% VAT (deductible). Null until confirmed for a given booking.';
