# Captain Scheduling, Time Tracking & Payroll (M1–M5)

## What was built

A complete crew-operations system: staff management, shifts generated
automatically from bookings, a captain portal for check-in/out and
availability, Slack slash commands and reminders, and a payroll tab with CSV
export and a personal calendar feed per captain.

The mental model: **bookings create work, shifts assign it, time entries
prove it, payroll pays it.** Each arrow in that chain is one module.

## Key files

### Data (M1)
| File | What it does |
|---|---|
| `supabase/migrations/068_captain_scheduling.sql` | `staff`, `shifts`, `staff_availability`, `time_entries` tables — RLS on, no policies (service-role only, same posture as bookings) |
| `supabase/migrations/069_shifts_availability_pk.sql` | `shifts.fareharbor_availability_pk` (UNIQUE) so shared departures map to exactly one shift |
| `src/lib/scheduling/staff-schema.ts` | Staff input validation + `staffBodyToRow()` body→row mapping shared by POST/PUT |

### Shift sync (M2)
| File | What it does |
|---|---|
| `src/lib/scheduling/generate-shifts.ts` | **Pure** bookings→shift-mutations logic (no I/O): create/update/cancel diffing, boat resolution, shared-departure grouping |
| `src/app/api/admin/scheduling/sync/route.ts` | Feeds the generator DB rows and applies its result |
| `src/app/api/admin/scheduling/shifts/route.ts` + `shifts/[id]/route.ts` | Week-grid data + shift create/update (assignment pings the captain on Slack) |
| `src/app/[locale]/admin/scheduling/ShiftsTab.tsx` | Boats × days week grid, status-colored chips, sync button |
| `src/app/[locale]/admin/scheduling/ShiftFormModal.tsx` | Assign/edit a shift; shows availability + weekly-load hints per captain |

### Captain portal (M3)
| File | What it does |
|---|---|
| `src/app/[locale]/captain/**` | Mobile-first portal: today's shift + check-in/out, my shifts, availability grid |
| `src/app/api/captain/**` | Portal API: `me`, `clock`, `shifts`, `availability` — staff row resolved from the logged-in user (`user_id` link) |
| `src/lib/scheduling/clock.ts` + `perform-clock.ts` | Clock-in/out rules (one open entry per staff, snapshot the hourly rate at clock-in) shared by portal AND Slack |

### Slack + crons (M4)
| File | What it does |
|---|---|
| `src/lib/slack/verify-request.ts` | HMAC-SHA256 signature check, 5-min replay window, fails closed (unit-tested) |
| `src/lib/slack/bot.ts` | One `slackCall` transport; `postToChannel` / `postDm` |
| `src/app/api/slack/commands/route.ts` | `/checkin` + `/checkout` slash commands → same `performClock` as the portal |
| `src/app/api/cron/shift-reminder/route.ts` | Every 5 min: DM captains whose shift starts in ~5–10 min and who haven't checked in; `reminder_sent_at` guarantees exactly one ping |
| `src/app/api/cron/auto-close-entries/route.ts` | Nightly: closes entries left open >12h at shift-end (max 4h), flags `auto_closed` for payroll review |

### Payroll + calendar (M5)
| File | What it does |
|---|---|
| `src/lib/scheduling/payroll.ts` | Pure payroll math: `entryMinutes`, `payForMinutes`, `aggregatePayroll`, `computeAutoCloseAt` |
| `src/lib/scheduling/payroll-query.ts` | `fetchPayrollRange()` — the ONE place that queries a payroll period (JSON + CSV share it) |
| `src/lib/scheduling/payroll-csv.ts` | RFC-4180 CSV export |
| `src/app/api/admin/scheduling/payroll/route.ts` + `payroll/csv/route.ts` | Period JSON / CSV download |
| `src/app/[locale]/admin/scheduling/PayrollTab.tsx` | Month navigation, per-staff totals, grand total, needs-review panel |
| `src/lib/scheduling/ics.ts` + `src/app/api/calendar/[token]/route.ts` | RFC-5545 calendar feed per captain, authenticated by `staff.calendar_token` URL secret |

## Architecture decisions

- **`staff` is separate from `user_profiles`.** A skipper can be scheduled,
  Slack-reminded, and paid without ever having a login; `staff.user_id` links
  a profile when they get portal access. People ≠ accounts.
- **Shift identity is two-keyed.** Private bookings → shift keyed by
  `booking_id` (UNIQUE); shared bookings → ONE shift per FareHarbor
  departure keyed by `fareharbor_availability_pk` (UNIQUE) — one sailing,
  one skipper, no matter how many parties booked it. Manual shifts (neither
  key) are never touched by the sync.
- **The sync is a pure function** (`generate-shifts.ts`): rows in, mutation
  list out. All the tricky rules (cancelled→rebooked revival, completed
  shifts never rewritten, admin's boat choice on shared shifts preserved)
  are unit-tested without a database.
- **Rates are snapshotted at clock-in.** `time_entries.hourly_rate_cents`
  is copied from the staff row when the entry opens, so a raise never
  rewrites past payroll periods.
- **One clock implementation.** Portal buttons and Slack `/checkin` both
  call `performClock` — the rules can't drift between surfaces.
- **Crons fail closed** via `requireCronSecret`; the Slack route verifies
  signatures with a replay window. Both follow existing project patterns.
- **Calendar feed uses a URL-secret token** (like the webchat token later
  adopted by the inbox) because calendar apps can't carry login sessions.

## How it works

```
bookings ──sync──▶ shifts (open) ──assign──▶ Slack DM to captain
                                     │
captain portal /captain  ◀───────────┘
  check in ──▶ time_entries (rate snapshot)   ◀── /checkin via Slack too
  check out ─▶ entry closed                   ◀── /checkout
       (forgot? nightly cron auto-closes + flags)

cron */5 min: shift starting soon + not checked in → DM reminder (once)

payroll tab: month → fetchPayrollRange → aggregatePayroll → table + CSV
calendar:    /api/calendar/{token}.ics → captain's shifts in their phone agenda
```

## How to extend

- **New staff field:** migration → regen types → `staff-schema.ts`
  (validation + `staffBodyToRow`) → `StaffTab` form.
- **New shift rule for the sync:** add it to `generate-shifts.ts` with a
  test first — it's pure, so the test needs no mocks.
- **New clock surface (e.g. WhatsApp):** call `performClock` — don't
  reimplement the rules.
- **New payroll column:** extend `payroll.ts` (+ test) and the CSV builder;
  both routes pick it up via `fetchPayrollRange`.

## Dependencies

- Depends on: `boats` (grid rows), `bookings` (shift source),
  `user_profiles` (portal links), Slack bot token + signing secret,
  `requireCronSecret`/`requireAdmin`, `createAdminClient`, Vercel crons
  (`vercel.json`).
- Depended on by: payroll accuracy depends on captains actually clocking —
  the reminder cron and auto-close flags exist to keep that honest.

## Environment

`SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_OPS_CHANNEL`,
`CRON_SECRET` (see `.env.example`).
