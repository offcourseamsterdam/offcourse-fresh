# Track F: Operations (Bookings, Planning, Crew)

**Phase:** 2
**Dependencies:** Track E (admin shell + auth)
**Parallel with:** Track G

## Objective
Build the operational backend: booking management, planning calendar, skipper management, and shift assignments using FareHarbor Crew Members API.

## Steps

### F1. Bookings List + Detail (`src/app/admin/bookings/`)
- Searchable, filterable table of all bookings from Supabase
- Filters: date range, status, boat, cruise type
- Detail view: full booking info, FareHarbor link, Stripe payment link, customer contact
- Status badges: booked, paid, cancelled, refunded

### F2. Operations Calendar (`src/app/admin/planning/`)
- Weekly/daily calendar view
- Show all FareHarbor availabilities (fetched daily, cached)
- Color coding: Diana = blue, Curaçao = orange
- Booking status per slot: open (green), booked (filled), in progress (yellow)
- Assigned skipper name on each slot
- Click slot → detail panel with booking info + skipper assignment

### F3. Skipper Management (`src/app/admin/crew/`)
- Create `skippers` table (see implementation plan)
- CRUD for skippers: name, email, phone, Slack user ID, preferred boat, certifications
- Sync with FareHarbor Crew Members API
- Availability overview per skipper (which days/shifts they're assigned)

### F4. Shift Assignment
- In the planning calendar, click a slot → assign skipper from dropdown
- When assigned: write to `shift_assignments` table + PUT to FareHarbor Crew Members endpoint
- Conflict detection: warn if skipper already assigned to overlapping slot
- Bulk assignment: assign skipper to all slots on a day

### F5. First-Party Analytics Dashboard (`src/app/admin/analytics/`)
- Create `analytics_pageviews` and `analytics_events` tables (see implementation plan)
- Implement `src/lib/analytics/tracker.ts` — lightweight client-side tracker (~2KB)
- Dashboard views:
  - Visitors over time (daily/weekly/monthly)
  - Top pages by views
  - Conversion funnel: visit → booking started → checkout → payment
  - Traffic sources (organic, direct, UTM campaigns, partner links)
  - Device/browser/country breakdown
  - Campaign performance with revenue attribution

## Verification Checklist
- [ ] Bookings table loads with search and filters
- [ ] Booking detail shows all info including FH and Stripe links
- [ ] Calendar renders availabilities from FareHarbor
- [ ] Skipper CRUD works
- [ ] Shift assignment updates both Supabase and FareHarbor
- [ ] Analytics tracker records page views and events
- [ ] Analytics dashboard renders with real data
