# FareHarbor External API v1 — Quick Reference

**Base URL:** `https://fareharbor.com/api/v1`
**Company shortname:** `offcourse`
**Auth headers (EVERY request):**
```
X-FareHarbor-API-App: {app_key}
X-FareHarbor-API-User: {user_key}
```

## Rate Limits
- 30 requests/second per IP
- 3,000 requests/5 minutes per IP

## Key Endpoints

### Items (Cruise Types)
```
GET /api/v1/companies/offcourse/items/
```
Returns all bookable items. Each item has customer_type_rates (boat+duration combos).

### Availabilities — Minimal (USE THIS for browsing)
```
GET /api/v1/companies/offcourse/items/{item_pk}/minimal/availabilities/date/{date}/
GET /api/v1/companies/offcourse/items/{item_pk}/minimal/availabilities/date-range/{start_date}/{end_date}/
```
- Max 7 days per range request
- Returns: pk, start_at, end_at, capacity, customer_type_rates (with capacity per rate)
- **Always prefer this over the full endpoint for date browsing**

### Availabilities — Full Detail
```
GET /api/v1/companies/offcourse/availabilities/{availability_pk}/
```
Use only when user selects a specific timeslot. Returns full details including resources.

### Booking — Validate (ALWAYS call before creating)
```
POST /api/v1/companies/offcourse/availabilities/{availability_pk}/bookings/validate/
```
Body:
```json
{
  "contact": {
    "name": "John Doe",
    "phone": "+31612345678",
    "email": "john@example.com"
  },
  "customers": [
    { "customer_type_rate": {customer_type_rate_pk} }
  ],
  "note": "Optional booking note"
}
```

### Booking — Create
```
POST /api/v1/companies/offcourse/availabilities/{availability_pk}/bookings/
```
Same body as validate. Only call AFTER successful validation AND payment.

### Booking — Cancel
```
DELETE /api/v1/companies/offcourse/bookings/{booking_uuid}/
```

### Crew Members
```
GET /api/v1/companies/offcourse/crew-members/
GET /api/v1/companies/offcourse/availabilities/{pk}/crew-members/
PUT /api/v1/companies/offcourse/availabilities/{pk}/crew-members/
```
For skipper assignment to timeslots.

## Webhooks

Register webhook URL in FareHarbor dashboard. Events:
- `booking.created` — new booking confirmed
- `booking.updated` — booking modified
- `booking.cancelled` — booking cancelled
- `item.updated` — item configuration changed
- `crew-member.updated` — crew assignment changed

Webhook payload includes full booking/item object.

## Critical Config

- **Resource capacity = 1** per boat. This is THE key check.
  - `rate.capacity >= 1` = boat is available for that timeslot
  - `rate.capacity < 1` = boat is already booked
- **6 Customer Types** (to be fetched via items endpoint — PKs will vary between demo/live):
  - Diana 1.5h (90min, max 8 guests)
  - Diana 2h (120min, max 8 guests)
  - Diana 3h (180min, max 8 guests)
  - Curaçao 1.5h (90min, max 12 guests)
  - Curaçao 2h (120min, max 12 guests)
  - Curaçao 3h (180min, max 12 guests)

## Response Format

All responses wrapped in an object with a descriptive key:
```json
{ "items": [...] }
{ "availabilities": [...] }
{ "booking": {...} }
```

## Error Handling

- 400: Bad request (validation errors in body)
- 403: Auth failure (check headers)
- 404: Resource not found
- 429: Rate limited (back off and retry)

## Demo vs Live

Both use the same endpoints and shortname `offcourse`. Only the API keys differ.
Use live keys during development, and for production.
