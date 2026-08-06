# AttendanceBot: what it does, what we already have, and what to build instead

**Date:** 2026-08-06
**Status:** Research + recommendation. Nothing built yet.

---

## Context — why this document exists

AttendanceBot is installed in the Off Course Slack workspace. It's a Slack-first HR tool
for time-off, attendance, timesheets and shift scheduling. The question was whether to
integrate it into our own admin software, and what AI features that could unlock.

The short answer: **we've already built most of it, and the part we've built is better
suited to a boat company than AttendanceBot could ever be.** The gaps that remain are
real but small, and they're cheaper to close in-house than to integrate.

This document explains why, then lays out the staff-ops AI features actually worth building.

---

## What AttendanceBot sells

Sourced from their own site and marketplace listing (August 2026).

| Area | What it does |
|---|---|
| **Time off / leave** | Custom leave types, accruals & banking, balances, request→approve flow in Slack, rules by office/tenure/employee |
| **Attendance** | In/out/available status, Google & Outlook calendar sync, channel announcements, office hoteling / hot desking |
| **Time tracking** | Clock in/out, timesheet reports, project/task/client tracking, overtime alerts, analytics |
| **Shift scheduling** | Shift templates, rosters, sign-ups, swap requests, vacation-aware scheduling, shift reminders |
| **Integrations** | Gusto, Wagepoint, JIRA, BambooHR, ADP, Rippling |
| **Interface** | Natural language in Slack — type "sick today" and it files the leave request |

**Pricing:** Free up to 5 users, but shift scheduling is **Pro-only** — $6/user/month
billed annually ($9 monthly). For our 2 staff that's ~$144/year.

**API reality check:** their public API is thin — Leave Records, Leave Balance,
Departments. Full API access is **closed beta, by request only**. A deep two-way
integration isn't actually on the menu today.

---

## What we already have

This is the surprising part. Off Course has quietly built most of an AttendanceBot.

| AttendanceBot feature | Off Course | Where |
|---|---|---|
| Shift rostering | ✅ **Better** — shifts auto-generate from real bookings | `src/lib/scheduling/sync-shifts.ts`, admin Scheduling → Shifts |
| Auto-schedule generation | ✅ **Better** — AI assigns captains, weighs availability, fairness, overlap AND cost | `src/lib/ghost/ops-drafters.ts` |
| Shift notifications | ✅ Slack DM with crew call, boat, hours and pay | `src/lib/scheduling/notify-assignment.ts` |
| Shift reminders | ✅ DM 5–10 min before start, skipped if already clocked in | `src/app/api/cron/shift-reminder/route.ts` |
| Clock in/out | ✅ Captain portal **and** `/checkin` `/checkout` in Slack | `src/lib/scheduling/clock.ts`, `src/app/api/slack/commands/route.ts` |
| Timesheets | ✅ `time_entries`, rate snapshotted at clock-in | `src/lib/scheduling/payroll.ts` |
| Payroll reports + export | ✅ Payroll tab + CSV export + bonuses | `src/lib/scheduling/payroll-csv.ts`, `review-bonuses.ts` |
| Availability collection | ✅ Captains set their own | `src/app/[locale]/captain/availability/page.tsx` |
| Self-service portal | ✅ Shifts, availability, clock | `src/app/[locale]/captain/` |
| Calendar sync | ⚠️ One-way iCal feed per captain (they subscribe; no write-back) | `src/lib/scheduling/ics.ts`, `/api/calendar/[token]` |
| Labour cost per shift | ✅ Rate × duration, shown in the assignment DM | `src/lib/scheduling/shift-cost.ts` |

**The genuine gaps:**

- ❌ Leave / PTO — no leave types, accruals, balances, or request→approve flow
- ❌ Shift swaps between captains
- ❌ Open-shift sign-up ("claim this shift")
- ❌ Overtime rules and alerts
- ❌ Timesheet approval step before payroll
- ❌ Live "who's on the water right now" board
- ❌ Natural-language Slack requests — ours are rigid slash commands only
- ❌ Payroll integrations (we export CSV instead)
- N/A Hot desking, project/client time tracking — irrelevant for boats

---

## The recommendation: don't integrate. Close the gaps in-house.

Four reasons, in order of weight.

### 1. AttendanceBot can't see bookings — and that's the whole game

AttendanceBot schedules people against *shift templates*. We schedule people against
*real FareHarbor bookings*. When a cruise sells at 17:00 on a Saturday, our system already
creates the shift, checks the boat, assigns a captain, works out what it costs, and messages
them — all before anyone opens an app. AttendanceBot has no idea a booking exists. Feeding
our schedule into it would mean maintaining the same roster twice.

### 2. It's a shared Slack app — Jannah can query it

AttendanceBot lives in the Off Course workspace and answers any member who messages it.
Putting our staffing, hours, and pay data inside it makes that data reachable by every
workspace member. Given you're separating from Jannah, moving *more* operational data
into a shared third-party tool is the wrong direction.

### 3. The API can't support a real integration anyway

Three documented endpoints, full access in closed beta. Even if we wanted deep two-way
sync, it isn't purchasable today.

### 4. Two staff don't need an HR platform

Accruals, tenure-based policies, approval chains and hot desking are built for 50-person
companies. At two people — one of whom is on a €0/h rate — that machinery is pure overhead.

**Worth reconsidering if:** the crew grows past ~8 skippers, or you start needing statutory
Dutch holiday-accrual tracking for employment compliance. Both are real futures, neither is today.

---

## ⚠️ Two things to decide before any of this

These surfaced during the research and matter more than the AttendanceBot question.

**1. The AI now auto-assigns Jannah shifts and DMs her.**
`staff` contains exactly two active rows: Beer (€35/h) and Jannah (€0/h). The proactive
scheduler shipped today picks from all active staff — so it can assign Jannah a shift and
send her a Slack DM saying *"You're on for Sat… Pay: €0.00"*. That reveals an automated
system exists, and the €0.00 reads as broken. Options: set her `is_active = false`, exclude
her from auto-assign specifically, or fix the rate. **Your call — flagging it, not deciding it.**

**2. Manual shifts are 13.5 hours long.**
The roster shows 09:00–22:30 blocks. At €35/h that's €472.50 of labour cost per shift.
Whether that's real hours or a placeholder changes every cost number the AI produces.

---

## The AI features worth building

Ranked by value-to-effort. Each one reuses machinery that already exists — the Ghost agent
framework, the proposal + autonomy ladder, the Slack bot, the shift/cost/payroll libs.

### Tier 1 — build these

**A. Sick-call recovery agent** ⭐ highest value
A captain messages *"can't make Saturday"* in Slack. The AI immediately finds the affected
shifts, ranks replacement candidates (available, no overlap, fair rotation, cost), DMs the
best one with a claim button, and escalates to you if nobody accepts within 30 minutes.
*Why it matters:* today a dropout is a phone-call scramble that risks a cancelled cruise —
this is real revenue protection, and the piece AttendanceBot genuinely cannot do because it
doesn't know a booking is at stake.
*Reuses:* `applyScheduleAssignments`, `draftOrAssignSchedule`'s candidate ranking, `postDm`.

**B. Natural-language Slack ops assistant**
Replace rigid `/checkin` with conversation: *"when's my next shift?"*, *"I'm sick tomorrow"*,
*"how much did I earn this month?"*, *"swap my Friday"*. This is AttendanceBot's one real
UX innovation — and we can do it better because our bot can also answer *"how many guests
on Saturday?"*.
*Reuses:* the Ghost agent tool-calling framework, existing Slack Events endpoint.

**C. Timesheet anomaly detection**
Catch forgotten clock-outs (open entry > 14h), clock-ins with no matching shift, and
scheduled-vs-actual gaps. Surface as proposals you approve — exactly the pattern already
used for booking corrections.
*Why it matters:* every one of these is a payroll error heading for the kasboek.

### Tier 2 — build when the crew grows

**D. Leave / time-off in Slack** — the biggest genuine AttendanceBot gap. A `staff_leave`
table, a request→approve flow, and the scheduler treating approved leave as hard-unavailable.
Only worth it past ~4 skippers.

**E. Shift swap broker** — captain requests a swap, AI finds who can legally cover, proposes
to both, applies on mutual accept. Needs 3+ captains to mean anything.

**F. Fatigue & overtime guard** — flag consecutive long days, short turnarounds (22:30 finish
→ 09:00 start), and weekly hour caps. Relevant *now* given 13.5-hour shifts, but it's a rule
engine, not really AI.

### Tier 3 — nice, not urgent

**G. Labour-cost forecast vs. revenue** — project the next 14 days' staffing cost against
expected booking revenue and flag margin-negative days (e.g. two boats staffed for one booking).

**H. Payroll pre-flight** — before the CSV export, an AI summary of the period: anomalies,
missing clock-outs, what changed vs. last period, in plain English.

---

## Suggested first step

Build **A (sick-call recovery)** on its own. It's the highest-value gap, it's the natural
next layer on top of the proactive scheduler that shipped today, and it needs no new
third-party dependency, no subscription, and no data leaving our own database.

**Verification when built:** simulate a dropout on a test shift, confirm the DM chain lands
in Beer's Slack only, confirm the replacement actually gets assigned in the Planning view,
and confirm the escalation fires when nobody accepts. Same test discipline as the scheduler:
unit tests for the ranking logic, `npm test` green, then a live check in the browser.
