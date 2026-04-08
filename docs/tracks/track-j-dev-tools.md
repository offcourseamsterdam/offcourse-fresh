# Track J: FareHarbor Dev Tools

**Phase:** 3
**Dependencies:** Phase 2 complete (needs admin shell)
**Parallel with:** Tracks H, I (fully independent)

## Objective
Build an internal dev tools page in the admin for testing and debugging FareHarbor API integration.

## Steps

### J1. API Explorer (`src/app/admin/dev/fareharbor/explorer/`)
- Dropdown: select endpoint (items, availabilities, bookings, crew-members)
- Input fields for parameters (item PK, date, availability PK)
- "Send Request" button
- Raw JSON response viewer with syntax highlighting
- Response time display
- Key toggle: switch between demo and live API keys

### J2. Availability Viewer (`src/app/admin/dev/fareharbor/availability/`)
- Date range picker
- Visual grid: rows = timeslots, columns = boats
- Cell colors: green = available, red = booked, grey = no availability
- Click cell → show raw availability data + customer_type_rates
- Shows how 3-layer filters would affect this data for each listing

### J3. Webhook Log Viewer (`src/app/admin/dev/fareharbor/webhooks/`)
- Table from `webhook_logs`: timestamp, source, event type, processed status, error
- Click row → full JSON payload viewer
- Filter by: processed/unprocessed, event type, date range
- "Reprocess" button for failed webhooks

### J4. Sync Status Dashboard
- Last sync time for items, resources, customer_types
- Sync health: any errors in last 24h
- Manual sync trigger button
- Diff view: what changed since last sync

## Verification Checklist
- [ ] API explorer sends requests to FH demo API
- [ ] Key toggle switches between demo/live
- [ ] Availability viewer renders grid for a date range
- [ ] Webhook log shows stored webhooks with full payload
- [ ] Sync status shows last sync time and health
