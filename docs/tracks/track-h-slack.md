# Track H: Slack Integration

**Phase:** 3
**Dependencies:** Phase 2 complete (needs skippers table, bookings, shift_assignments)
**Parallel with:** Tracks I, J (fully independent)

## Objective
Integrate Slack for automated notifications: shift reminders, booking alerts, daily briefings.

## Steps

### H1. Slack Client Setup
- Install `@slack/web-api`
- `src/lib/slack/client.ts` — initialize with bot token from env
- Create `slack_notifications` table (see implementation plan)

### H2. Shift Reminders
- Vercel cron job runs twice daily (e.g., 8:00 and 16:00)
- Query `shift_assignments` for shifts in next 24h / next 2h
- Send DM to skipper's Slack (using `slack_user_id` from `skippers` table)
- Message includes: date, time, boat, departure location, any booking notes

### H3. Booking Notifications
- Triggered by Stripe webhook (`payment_intent.succeeded`)
- Post to `#bookings` channel: new booking with customer name, date, boat, duration, amount
- Also triggered by FareHarbor webhook (`booking.cancelled`)
- Post cancellation with booking details

### H4. Daily Briefing
- Vercel cron job: 7:00 AM daily
- Post to `#operations` channel:
  - Today's bookings (time, boat, skipper, guest count)
  - Unassigned shifts (slots without skipper)
  - Weather forecast (optional: fetch from weather API)
  - Revenue summary (yesterday + month-to-date)

### H5. Admin Notification Config
- Admin page: configure which channels receive which notifications
- Toggle notifications on/off per type
- Test button to send a sample notification

## Verification Checklist
- [ ] Slack bot can post to a test channel
- [ ] Shift reminder sends DM to correct skipper
- [ ] Booking notification posts on successful payment
- [ ] Cancellation notification posts on FH webhook
- [ ] Daily briefing posts at scheduled time
- [ ] Admin can configure notification channels
