# The AI Ops Orchestra — Gap Analysis

**Status:** Analysis only — nothing here is built or scheduled. For discussion.
**Date:** 2026-08-07
**Branch:** `feature/ai-ops-engine-main-sync` (local only, per the confidentiality note in CLAUDE.md)

## The metaphor, made concrete

An orchestra only sounds like one thing — "music" — because every player reads
the same score and comes in at the right bar. Off Course's Ghost system today
has several very good individual players (the inbox drafter, the scheduler,
the catering drafter) but **no shared score**. Each one currently runs off its
own clock (a cron time, a webhook) and knows almost nothing about what the
others are doing for the *same booking*. That's the single idea this whole
document keeps coming back to — see Part 4.

To get there, this document works backwards from real life:

1. **Part 1** — what a customer, a captain, and you (the manager) actually
   *do*, step by step, running a boat tour company in Amsterdam.
2. **Part 2** — what Ghost/the ops system currently covers for each of those
   steps (pulled from a fresh code audit, not from memory of what we built).
3. **Part 3** — the gaps: places where a journey step has no instrument
   playing at all, or two instruments playing different tunes.
4. **Part 4** — the one structural gap that explains most of the others: no
   conductor.
5. **Part 5** — a direct answer to the "is AI even the right tool here"
   question you raised about captain scheduling, because it's really a
   special case of the same theme (don't use a violin to hammer a nail).

---

## Part 1 — The three journeys

### A. Customer journey

1. **Discovery.** Google search ("boat tour Amsterdam", "private canal cruise
   Amsterdam"), Instagram/ads, word of mouth, or an OTA listing (Withlocals,
   GetYourGuide, Viator, GetMyBoat, Click&Boat, Barqo).
2. **Questions, before booking.** Real questions this business gets, over and
   over, across every channel (webchat, WhatsApp, email, Instagram DM, or the
   OTA's own chat):
   - "Is this a private boat or do we share it with strangers?"
   - "How many people fit on Diana / Curaçao?"
   - "What's included — drinks, snacks, music?"
   - "Can we bring our own alcohol / food?"
   - "What happens if it rains?"
   - "Where exactly do we meet you? Is there parking?"
   - "Can you pick us up somewhere else along the canal?"
   - "Is there a toilet on board?"
   - "Can we add catering / decorate for a birthday / bring a cake?"
   - "Do you speak Spanish / German / Portuguese?"
   - "Is the boat wheelchair accessible?"
   - "What's your cancellation/refund policy?"
   - "Can I pay in installments / by bank transfer / split with friends?"
   - "Discount for a group of 15?"
   - "Can we bring a dog?"
   - "Can we book a longer slot than what's shown?"
3. **Booking.** Picks a boat/time, pays (Stripe, or through the OTA's own
   checkout), gets a confirmation.
4. **Between booking and the day.** Wants to add/change catering, change
   headcount, move the date (illness, weather worry, flight change), asks
   logistics ("what should we wear", "is there a bar/toilet stop"), sometimes
   just goes quiet until the day.
5. **Day of.** Arrives, meets the captain, boards, tour happens; may ask for
   something on the fly (extend, music, an extra stop).
6. **After.** Leaves (or doesn't leave) a review on Google/TripAdvisor/OTA;
   may want photos; may want an invoice for a work expense; may complain
   about something (weather cut the trip short, a mixed-up detail); may want
   to book again or refer a friend.

### B. Captain (employee) journey

1. **Onboarding.** Added to `staff`, given a rate, linked to Slack, shown how
   the boats/route work.
2. **The weekly rhythm.** States availability (via the captain self-service
   page). Gets assigned to shifts. Clocks in/out via Slack (`/in`, `/out`).
   Gets paid based on logged hours.
3. **Day of, per tour.** Knows which boat, which guests, headcount, any
   catering that needs to be aboard and at what time, any special requests.
   Reports a maintenance issue if one comes up (Slack channel → AI triage).
4. **Exceptions.** Gets sick and needs to say so *before* a shift, not after.
   Wants to swap a shift with another captain. Disagrees with a logged
   hour/pay calculation. Notices a booking's guest count or time looks wrong
   in the system and needs a way to flag it back.
5. **Multi-boat future.** At 5 boats, a captain routinely runs several tours
   back to back — needs a single clear "here's my whole day" view, not four
   separate DMs.

### C. Manager (you) journey

1. **Daily check-in.** What's happening today/this week (Planning), what
   needs a reply (Inbox), what food orders are pending (Catering), what did
   the AI do overnight that you should sanity-check (Ghost Activity panel).
2. **Weekly/monthly.** Payroll, OTA payout reconciliation, Google Ads spend
   review, quarterly invoicing.
3. **Exceptions.** A booking cancels last-minute. Weather looks bad for
   tomorrow. A captain calls in sick same-day. A customer is unhappy.
   Something needs a technician.
4. **Strategic.** Hiring, adding boats, marketing spend, pricing.
5. **Trust in the system.** You need to *see* what an autonomous agent did
   (visibility), be able to *override* it easily (control), and trust it
   will never do something irreversible or embarrassing on a live customer
   or a real payment without a human in the loop first (safety).

---

## Part 2 — What's currently covering each step

(Full technical inventory available on request — this is the journey-shaped
summary. "Shadow" = AI drafts, a human sends/approves. "Auto" = the system
acts for real without waiting for a click.)

| Journey step | Covered by | Autonomy |
|---|---|---|
| Customer questions (any channel: webchat, WhatsApp, Gmail) | `reply_draft` — reads real availability/booking data, drafts a reply | Shadow — human sends |
| OTA (Withlocals/GetMyBoat) new-request notification | `ota_availability` — checks real availability, writes a fact card | Shadow (fact-only, doesn't reply to the guest) |
| Booking a slot | `booking_proposal` (validates, never books) + Stripe checkout | Dry-run, pinned — can never become auto |
| Wrong contact info on a paid booking | `booking_correction` | Ask — human approves |
| Catering order to supplier | `catering_order` (draft) **and** a separate always-on auto-send cron once ≤7 days out | Split: shadow draft *or* real auto-send, depending on which path |
| Drinks-only guest catering upsell | `catering_upsell` (Ghost) **and** a separate always-on zero-extras upsell cron | Split, same pattern as above |
| Captain assignment | `schedule_day` | **Auto** — assigns for real; DM to captain held until you click "Confirm & send" |
| Captain clock-in/out | Slack `/in` `/out` | Human action, no AI |
| Shift check-in reminder | Cron, 5–10 min before start | Automatic notification, no AI judgement |
| Maintenance report → technician email | `maintenance_task` | Shadow |
| Stock reorder | `stock_reorder` | Shadow |
| "Should we merge two half-empty tours tonight" | `ops_review` | Shadow |
| "Ask a guest to shift their slot to close a gap" | `guest_move_request` | Dry-run |
| Google Ads overspend | ads-guardrail cron | **Auto** — pauses campaigns for real (outside the Ghost ladder entirely) |
| Payment reminders (unpaid link) | Cron | Automatic, no AI |
| FareHarbor drift detection | Cron | Automatic alert, no AI |
| Staff availability capture | Captain self-service page | Human-submitted, AI-read only |
| Review collection (reading) | Weekly crons (GetYourGuide, Withlocals) | Reads only — no soliciting |

---

## Part 3 — The gaps

Ranked by how often they'd actually bite, not by how interesting they'd be
to build.

### 1. Nobody asks the customer for a review or sends them their photos

The system *reads* Google/GetYourGuide/Withlocals reviews weekly, but nothing
in the codebase *prompts* a guest to leave one, or follows up with a "here's
a link to your photos" email after the tour. For a small tour company,
review volume is one of the highest-leverage things there is (it feeds
GetYourGuide/TripAdvisor ranking directly, and "hidden gems, real Amsterdam"
positioning lives or dies on word-of-mouth proof). This is a same-shape
problem as `catering_upsell` — a scheduled, personalized email — and would
be a small build.

### 2. No weather-disruption handling

Electric, open boats, in a city where it rains on short notice — and nothing
in the system watches the forecast against tomorrow's departures or drafts
"looks like rain at 3pm, want to move to the 5pm slot?" This is squarely a
Ghost-shaped problem (read data, draft an action, human approves) and
squarely un-built.

### 3. Sick-call recovery has no agent (already identified, not yet built)

This came up directly in the AttendanceBot research
(`docs/plans/2026-08-06-attendancebot-analysis-and-staff-ops-ai.md`): a
captain calling in sick same-day is one of the highest-stress moments in
day-to-day ops, and today it's 100% manual (Slack message → you scramble).
Restating it here because it's a real gap in the captain journey, not just an
interesting idea from the research doc.

### 4. OTA guest messaging — the two-tier customer experience

A guest who messages through your website gets an AI-drafted reply inside
minutes (once you approve it). A guest who messages through Withlocals'
own chat gets... you, manually, in a different tab, whenever you notice.
Same company, two different response speeds, depending entirely on which
platform the guest happened to book through. `docs/plans/2026-08-04-ota-autonomous-agent.md`
already scopes the fix; it's explicitly marked **not started**, which is
fine — but it's worth naming as the single biggest gap in the *customer*
journey, not just a future nice-to-have.

### 5. No day-before "what's my day look like" for captains

At 2 boats this is manageable from memory. At 4 tours/day per captain (your
own cap, see Part 5) it stops being manageable — a captain needs one message
each morning: today's tours, times, headcounts, any catering notes. Right
now they get a DM per assignment and a reminder per shift, not one picture
of the whole day.

### 6. No captain-side "something's wrong" channel

A captain who thinks a booking's guest count or time is wrong, or disputes a
pay calculation, has no structured way to flag it — it's a Slack message to
you, informally. Small, but it's a real gap in the employee journey, and the
fix (a lightweight flag that lands as a normal admin notification) is cheap.

### 7. Two different rulebooks for "autonomous"

`schedule_day` (captain assignment) and `ads-guardrail` (auto-pausing
campaigns) both take real, unattended action — but only `schedule_day` goes
through the governed `agent_proposals` / autonomy-ladder machinery with its
audit trail and learning loop (`evaluate.ts`). The catering auto-send cron
and the ads-guardrail auto-pause act for real completely outside that
system. That's not necessarily wrong — a hard-coded "stop bleeding money"
rule doesn't need Claude's judgement — but it means "what did the AI/system
do on its own this week" has two different places to look, and only one of
them is visible in the Ghost Activity panel. Worth deciding, once, whether
every auto-executing action should report into one shared event log even
when it isn't Claude-driven.

### 8. CLAUDE.md's own description of Ghost is out of date

Small, but real: the "Shadow AI / Ghost Rule" section still says the Ghost
"never executes anything" and lists two kinds — it's actually 10 kinds
across 9 agents, and `schedule_day` reached `auto` autonomy on 2026-08-06.
The newer "direction this branch is building toward" section is accurate;
the older paragraph above it isn't. Worth a documentation pass so the next
person (including future-you) isn't misled by your own repo's ground truth.

### 9. No unified per-booking timeline

This is really Part 4 below, but it belongs on this list too: there's no
single place that says, for booking #4821, "confirmed → catering ordered →
captain assigned → day-before reminder sent → completed → review asked." Each
piece exists; none of them know about each other beyond reading the same
database tables independently.

---

## Part 4 — The conductor gap

This is the throughline. CLAUDE.md's own vision (the section added
2026-08-06) already says it in plain language:

> If a booking comes in, an order is sent. A captain is assigned and
> informed at the right moment. A direct schedule is sent... This should
> cover what happened and what people are going to be doing.

What's actually built is very good *sections* of that sentence, each on its
own independent clock:

- Catering cron: daily 08:30 UTC
- Ghost ops cron (scheduling, catering drafts, ops review): daily 15:00 UTC
- Extras upsell cron: daily 08:00 UTC
- Gmail sync: every 2 minutes
- Shift reminder: every 5 minutes

Every one of these re-scans a slice of the database and asks "is there
anything to do *right now*, for anyone." None of them ask "where is *this*
booking in its life, and what's the next thing that should happen to it."
That's the difference between five session musicians and an orchestra — the
notes are all being played, but nothing guarantees they land in the right
order relative to *each other* for a specific guest.

You don't need a rewrite to fix this. The practical version is a lightweight
**per-booking state machine** (or even just a `next_action`/`stage` column on
bookings) that the existing agents read and write instead of independently
re-deriving "is this booking due for X" from raw dates every time. It's the
kind of change that pays for itself the moment you have 5 boats and dozens
of bookings mid-flight on any given day — right now, with 2 boats, the
independent-cron approach still mostly works because volume is low enough
that nothing collides. That headroom is shrinking, not growing.

---

## Part 5 — Is AI even the right tool for captain assignment?

Direct answer to what you raised: **for the assignment decision itself, no —
you're right, and a plain rule beats Claude here.**

Your rule, stated plainly: *new tour → assign it to a captain already working
that day if they have room (under the daily cap, no time overlap) →
otherwise assign the next available captain → cap at 4 tours/day per
captain.* That's a lookup and a comparison, not a judgement call. A
deterministic function does that in one pass, for free, every time, with a
decision you can read top to bottom — no API cost, no chance of drifting.

There's real evidence for this already in the system: the exact
inconsistency you and I dug into a day ago (Aug 19/21 → skipped, Aug 23 →
assigned, for what was the *same* "nobody has stated availability" shape of
situation) happened *because* it's an LLM making the call. A rule can't do
that — it gives the same answer to the same input every time, which is
precisely the property you want for "assign the obvious next captain."

Where judgement genuinely earns its keep is the fuzzier layer above that
lookup — `ops_review`'s "should we merge two half-empty tours to save a
crew," or, once you have 5 boats and captains have real skill/preference
differences, "who's the *better* fit, not just an available one." Those are
comparisons between options with soft trade-offs, which is what Claude is
actually good at. The clean split going forward: **deterministic code
decides who's assigned; AI only gets involved for the genuinely ambiguous
trade-off calls on top of that.**

I haven't touched `schedule_day`'s implementation — this is a
recommendation, not a change. Happy to make the swap (keeping the exact same
guardrails — never assign someone marked unavailable, never double-book) if
you want it.

---

## Not covered here

Financial/OTA payout reconciliation across Withlocals, Revolut, Barqo, etc.
is its own big manual process today (see prior memory on VAT handling) — it's
a real gap in the manager journey but a separate, already-partially-scoped
piece of work, not folded into this pass.
