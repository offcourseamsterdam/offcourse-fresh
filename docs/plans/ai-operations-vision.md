# Vision — AI Operations Layer on a Single Source of Truth

**Status:** architecture vision + roadmap. Builds on
`unified-inbox-and-comms.md` (Phase 0 foundation is shared).

---

## 1. The keystone principle

> One operational database (Supabase Postgres) is the **single source of
> truth** for every domain — bookings, conversations, stock, schedules,
> finance. AI never *is* the system of record and never acts directly:
> **AI reads the truth, writes a *proposal*, a human approves, and the
> approval itself becomes data.**

This gives one repeating loop for every AI feature, present and future:

```
        SIGNAL                    PROPOSAL                 DECISION
 (new email / low stock / ┌──────────────────┐   ┌──────────────────────┐
  next week's schedule    │ AI reads the DB,  │   │ Human approves, edits │
  needs making / demand   │ drafts an action  │──▶│ or rejects — one tap  │
  spike)                  │ + reasoning       │   │ in admin or Slack     │
                          └──────────────────┘   └──────────┬───────────┘
                                   ▲                        │
                                   │     OUTCOME RECORDED   ▼
                          ┌────────┴─────────────────────────────┐
                          │ agent_proposals: what was proposed,   │
                          │ what the human changed, what happened │
                          │ → context for the NEXT proposal       │
                          └──────────────────────────────────────┘
```

The `agent_proposals` table from the inbox plan generalizes to every
domain with a `kind` column: `ota_booking`, `reply_draft`, `stock_order`,
`schedule_week`, `demand_forecast`. One pattern, one UI affordance
(proposal card + Confirm/Edit/Reject), one audit trail, one trust ladder
(always-ask → auto-with-undo → auto) **per kind**.

**Why this is the "self-learning" answer too:** every approval, edit, and
rejection is labeled training signal. Not by retraining a model — by
*retrieval*: the next proposal's prompt includes "here are the 5 most
similar past situations and what the human actually did." The system gets
smarter the way a new employee does: by being corrected and remembering.

---

## 1b. Agents are API clients, never UI users (hard rule)

The build order is: **traditional human-powered UI first, agents later —
and the agents call the same functions the UI calls, not the UI itself.**

```
                 ┌────────────────────────────────┐
   Admin UI ────▶│  Shared logic layer             │
   (humans click)│  src/lib/* + /api/admin/*       │────▶ Postgres
   AI agents ───▶│  (validation, money math, FH,   │      (the truth)
   (jobs call)   │   notifications, audit)         │
                 └────────────────────────────────┘
```

- **No browser automation, ever, for internal operations.** An agent
  driving the admin UI would be slow, brittle (breaks on every redesign),
  unauditable, and would hold a human's session. Agents are backend jobs
  that call the same `lib/` functions and `/api/admin/*` routes the UI
  buttons call — e.g. the booking agent's "Confirm" executes
  `POST /api/admin/booking-flow/book`, the *exact* endpoint the FareHarbor
  wizard in the UI uses. Same validation, same Slack notify, same dedupe.
- **This is why "human UI first" is not a detour.** Building the manual
  rota / stock pages / inbox forces the logic into shared, tested
  functions. Those functions ARE the agent's toolbox later. The humans
  battle-test the exact code paths the agents will call.
- **Agent identity & permissions:** agents run as queue jobs with their
  own service identity (`performed_by: 'agent:<kind>'` on every write),
  scoped to the specific functions their kind needs — never a person's
  session, never blanket admin. Every action lands in `agent_proposals` /
  audit rows, visible in the UI as system lines ("AI ordered 24 prosecco
  — approved by Beer, 14:02").
- **Changeable & reversible:** proposals are editable before approval;
  approved actions get an undo window where the underlying operation
  supports it (pause campaign, unsend rota); irreversible operations
  (refunds, FH bookings) stay behind explicit human approval permanently.

---

## 2. Self-learning reply drafting (inbox)

Mechanism, honestly described — three rungs, no magic:

1. **Rung 1 — context stuffing (week 1 of inbox v1).** Draft prompt =
   brand voice (`lib/ai/context.ts`, already written) + this conversation
   + the customer's bookings. Already produces on-voice drafts.
2. **Rung 2 — retrieval from your own history (the real win).** Embed
   every *sent* (i.e. human-approved) reply with its question context
   into **pgvector** (a Postgres extension — Supabase supports it, so the
   single source of truth keeps holding everything, embeddings included).
   New message → find the 5 most similar past exchanges → include them as
   examples: "this is how we answered this before." Edits matter:
   store the AI draft *and* the human-edited final; the diff teaches
   ("Beer always removes exclamation marks, always offers the 18:00 slot
   as alternative").
3. **Rung 3 — distilled playbook (quarterly, automatic).** A periodic job
   has Claude read the last quarter's approved replies and update a
   `support-playbook.md` ("dogs: allowed, mention towel; rain policy:
   reschedule free; refunds: …") which feeds rung 1. This catches
   *policies*, which retrieval alone can miss.

No fine-tuning needed at this volume — retrieval + playbook beats it on
cost, transparency (you can *read* why the AI said something), and
correctability (delete a bad example, behavior changes immediately).

---

## 3. Stock & ordering (QR-driven, human-in-the-loop)

**The trick that makes this practical: a QR code is just a URL.** No
hardware, no app — a laminated QR on each storage crate/shelf opens the
phone browser at `/admin/stock/count/[itemId]` (behind admin auth, which
already works on mobile).

**Data (the truth):**
```
stock_items   id, name, unit ('bottle'|'can'|'piece'), category,
              par_level (target), reorder_point, supplier_id,
              consumption_model null ('per_guest'|'per_booking'|'fixed')
stock_counts  id, item_id, counted_qty, counted_by, counted_at, note
              — append-only; current level = latest count − recorded usage
stock_orders  id, supplier_id, lines jsonb, status
              ('proposed'|'approved'|'sent'|'received'), proposal_id FK
suppliers     id, name, email, whatsapp, order_method, lead_time_days
```

**The physical loop:** skipper finishes a cruise → scans the crate QR →
page shows the item, big +/− stepper, **[Save count]** — 10 seconds on a
phone. (Same flow works for receiving deliveries.)

**The AI loop (weekly cron + event-triggered):**
1. Read latest counts + **upcoming bookings** (guests × consumption
   model: "Saturday has 3 cruises, 26 guests; prosecco runs ~0.4
   bottle/guest historically") + supplier lead times.
2. Propose: "Order 24 prosecco, 48 beer from <supplier> — you'll dip
   below reorder point before Friday." → proposal card + Slack.
3. Human approves (possibly edits quantities) → order email/WhatsApp to
   the supplier goes out through the same outbound queue as everything
   else; status → `sent`; receiving scan closes the loop → `received`.
4. Actual consumption (count deltas vs guest numbers) continuously
   recalibrates the per-guest model — self-learning again, from data the
   QR scans produce as a by-product.

Catering extras already in the DB (`extras`, booking extras) tell the AI
what's been *pre-sold* for upcoming cruises — pre-orders of 4 charcuterie
boards next weekend show up in the stock forecast automatically. That's
the single-source-of-truth dividend: domains compound.

---

## 4. Captain / skipper scheduling

Three stages, each shippable alone:

**Stage 1 — manual rota (the truth first).**
```
staff          id, name, phone, role ('skipper'|'host'), active,
               max_shifts_week, employment_type
staff_availability  staff_id, date, available ('yes'|'no'|'prefer_not')
               — skippers submit via a simple mobile page (same QR/URL
               trick: personal link, tap days)
shifts         id, date, start_at, end_at, boat_id, staff_id null,
               booking_id null, status ('open'|'assigned'|'confirmed')
```
Admin calendar page: week × boat grid, assign from a dropdown of
available staff. Bookings auto-create `open` shifts (a confirmed private
cruise needs a skipper — the booking row already has date/time/boat).
WhatsApp notification to the skipper on assignment (the outbound
infra from the inbox plan — again, compounding).

**Stage 2 — AI fairness scheduler.** Weekly job drafts next week's rota:
constraints (availability, one boat = one skipper, rest gaps, max shifts)
+ fairness objectives (weekend shifts spread evenly *over a rolling 8
weeks*, sunset-cruise "good shifts" rotated, preferences respected when
possible). Output = proposal card showing the draft rota **with its
reasoning per assignment** ("Jannah has had 3 of last 4 Saturdays off →
gets this one off too"). Human drags to adjust → approve → notifications
go out. Every manual adjustment is recorded — the fairness model learns
what the humans actually consider fair.

**Stage 3 — demand prediction → staffing needs.** The inputs already
exist in the truth: 18+ months of bookings (date, lead time, party size,
boat), tracking sessions (demand *pressure*, not just conversions),
seasonality, day-of-week, and — worth adding — public holidays + weather
forecast. Start embarrassingly simple: same-weekday rolling averages by
season with a weather modifier, shown as "expected bookings next
weekend: 5–7 (last 4 Saturdays: 4,6,6,7)". That feeds: how many skippers
to schedule, when to open/close FareHarbor availability, when to boost
ads (the Google Ads CLI already exists for the acting part). Fancy
models only if the simple one proves insufficient — the *plumbing* (a
`demand_forecasts` table proposals can cite) matters more than the math.

---

## 5. Finance (later, same pattern)

Already in the truth: every booking's amounts, VAT split, city tax,
extras, promo discounts, partner commissions (`partner_settlements`),
Stripe payment intents, Google Ads spend (via the reporting CLI).
The missing pieces are **cost rows** (fuel/maintenance/mooring/staff
hours — staff hours fall out of Stage-1 shifts automatically) and an
**export discipline** (monthly close job: revenue/VAT/costs → CSV or
accounting-software import). Then the same loop: "AI noticed margin on
shared cruises dropped 8% this month — catering costs up; review
supplier?" Proposal, human judgment, recorded outcome.

Rule that keeps this future clean: **never store money facts anywhere
except Postgres rows written by the existing money paths.** No
spreadsheet copies that drift; the spreadsheet is an *export*, never an
input.

---

## 6. What this demands of the data layer (the discipline list)

1. **Every domain gets real tables before it gets AI.** Manual rota
   before AI rota; stock counts before order proposals. (AI on top of
   vibes is hallucination with extra steps.)
2. **Append-only events where history is the value**: stock_counts,
   agent_proposals, messages, shifts changes. History is what the AI
   learns from; never UPDATE it away.
3. **One `agent_proposals` table for ALL domains** — `kind`, `payload`
   jsonb (zod-validated per kind), `reasoning` text, `status`,
   `human_edits` jsonb, `outcome` jsonb. The trust ladder is a per-kind
   setting in one place.
4. **pgvector lives in the same database** — embeddings are data, not a
   second system to keep in sync.
5. **Proposals cite their sources** (booking ids, count ids, message ids)
   so a human can always click through to the underlying truth.
6. RLS + service-role posture identical to bookings (established
   pattern), and every new write path behind `requireAdmin` or queue jobs.

## 7. Sequencing (merged with the inbox plan)

| Order | Thing | Why this order |
|---|---|---|
| 1 | Phase 0 foundation (queue, Sentry, webhook_logs) | gates everything |
| 2 | Inbox + AI booking agent (other plan, phases 1–4) | revenue + the first proposal loop end-to-end |
| 3 | Reply retrieval (pgvector) + playbook | rides on inbox data accumulating |
| 4 | Stock v1: tables + QR count pages | tiny build, immediate value, starts the consumption dataset |
| 5 | Scheduling Stage 1 (manual rota + availability links) | the capacity-planning truth the audit said is greenfield |
| 6 | Stock ordering proposals · Scheduling Stage 2 (AI rota) | both are "proposal kinds" on existing loops |
| 7 | Demand forecasts → staffing/ads · Finance close | needs the accumulated truth above |

Rough shape: items 4–5 are ~1–1.5 weeks each; 6 is ~1 week each kind;
3 is ~1 week. None are blocked on each other after item 2 — they can be
picked in whatever order the business screams for.

---

## 8. Improvement ideas (brainstormed 2026-06-10)

### A. Making human-in-the-loop actually liveable

- **A1. The "Today" screen (morning ritual).** One admin page: every
  pending proposal sorted by urgency, plus today's operational picture —
  cruises & skippers, weather, stock flags, unanswered conversations.
  Five minutes with coffee = the company is run. This becomes THE landing
  page of the admin; everything else is drill-down. *(High value, small
  build — it's a read-only composition of tables that already exist in
  the plans.)*
- **A2. Approve from chat.** Proposals already ping Slack with a link;
  upgrade to Slack interactive buttons (Approve / Open) and later
  WhatsApp quick-replies. Approval latency is the real constraint on
  human-in-the-loop — if approving takes 3 seconds from a phone, the
  human never becomes the bottleneck.
- **A3. Proposal expiry + escalation ladder.** Every proposal kind gets a
  TTL and an escalation path: unanswered 30 min → Slack re-ping →
  WhatsApp to Beer → safe fallback at deadline (e.g. OTA booking request:
  fallback is "reply availability not confirmed yet" rather than silence;
  stock order: roll into next week's proposal). Prevents "AI waited
  politely while the customer walked away."
- **A4. Voice memo → operations.** Beer records a voice note in the admin
  on his phone ("white wine is finished, and Jannah can't skipper
  Sunday") → transcription → agent converts it into structured proposals
  (stock count adjustment + availability change), each approvable as
  usual. The natural input device for someone standing on a boat is
  voice, not forms. *(Rides on the inbox's transcription pipeline.)*

### B. Making the AI measurably trustworthy

- **B1. Agent scoreboard.** Per agent kind: proposals made, approval rate,
  edit rate (approved-but-corrected), time-to-approval, outcome accuracy.
  The trust ladder (§1) stops being a feeling: "booking agent ran 60 days
  at 97% approval, 0 incidents → promote to auto-with-undo" is a
  decision you read off a dashboard.
- **B2. Shadow mode for every new agent.** Before any proposal kind goes
  live, it runs silently for 2 weeks: proposals are generated and logged
  but not shown (or shown only in a "shadow" tab). Compare against what
  the humans actually did in the same period — free evaluation, zero
  risk. No agent kind ships without a shadow-mode report.
- **B3. Outcome tracking closes the loop.** Proposals store their
  *prediction* ("ordering 24 covers next week"); a later job records what
  actually happened (stock-out anyway? booking materialized? forecast vs
  actual demand). Per-kind accuracy feeds B1 and recalibrates models.
  Without this, "self-learning" is a slogan.
- **B4. Weekly AI digest.** Monday email/Slack: what the AI staff did —
  bookings confirmed, replies drafted (% sent unedited — the quality
  metric), orders proposed, anomalies flagged, scoreboard deltas. Builds
  Beer's intuition for where the system is strong/weak; doubles as drift
  detection.

### C. Off-Course-specific intelligence (the moat)

- **C1. The weather brain.** For an Amsterdam boat company, weather IS the
  operating system. Ingest a forecast API (KNMI/open-meteo) into the
  truth as first-class data → every agent uses it: demand forecast
  modifier, rota sizing, stock timing, and — the killer — a **weather
  playbook proposal**: 48h before forecast rain/wind on a booked slot,
  the agent drafts the full response plan (affected bookings, reschedule
  options pulled from real FH availability, pre-written guest messages in
  the right languages) as ONE proposal. Beer approves; the rainy-Saturday
  fire-drill becomes a two-tap routine. "Rain or shine" pill on the site,
  but operationally: rain → shine.
- **C2. Business anomaly watchdog.** The ads-guardrail pattern,
  generalized: a daily agent reads the truth and flags deviations —
  bookings vs forecast, conversion-rate dip (tracking tables), refund
  spike, FH-vs-Supabase mismatches, supplier price creep. Current
  alerting fires on *system failures*; this fires on *business surprises*.
  Each flag is a proposal-shaped card ("investigate / explain / dismiss"),
  and dismissals teach it what's normal.
- **C3. Review-mining loop.** Reviews already sync via Outscraper. An
  agent extracts structured themes per boat/cruise/skipper (praise,
  complaints, mentioned moments) → feeds the support playbook ("guests
  ask about blankets — we have them, say so proactively"), listing copy
  proposals ("12 reviews mention the sunset at Magere Brug — it's not in
  the description"), and ops flags ("3 mentions of late departure on
  Saturday shared cruises").
- **C4. Customer memory (VIP layer).** The contacts table accumulates:
  repeat guest count, preferences (prosecco vs beer, brings dog,
  celebrated anniversary aboard), past hiccups. Inbox sidebar surfaces it;
  reply drafts use it ("welcome back — 5th time aboard!"); the booking
  agent flags VIPs to the skipper's day sheet. Cheap to build, and it's
  exactly the "friend with a boat" brand made literal: a friend
  *remembers*.

### Recommended first three: A1 (Today screen) + B1/B2 (scoreboard +
shadow mode, they're one feature in practice) + C1 (weather brain).
A1 makes the system pleasant daily, B makes it promotable safely, C1 is
the highest-leverage Amsterdam-specific intelligence.

---

## 9. Maintenance board (boats break; the system should know)

A `/admin/maintenance` tab: kanban board of everything broken, being
fixed, or due for service — with captains reporting from the dock in
30 seconds.

**Data:**
```
maintenance_issues  id, boat_id FK, title, description, photos jsonb,
                    severity ('blocking'|'urgent'|'normal'|'cosmetic'),
                    status ('reported'|'triage'|'planned'|'in_progress'|'done'),
                    reported_by (staff or 'agent'), assigned_to null,
                    cost_cents null, due_date null, resolved_at null,
                    recurrence_of FK null  ← "3rd time this part" tracking
```

**Captain reporting — two zero-friction paths:**
1. **QR on each boat** (the QR-is-a-URL trick again): scan → phone page →
   photo, voice note or short text, severity tap → submitted. 30 seconds
   between guests.
2. **Just WhatsApp it.** Captains message the business number a photo of
   the broken pump — the inbox classifier (§ inbox plan) detects
   maintenance intent from staff numbers and creates the issue card
   automatically, replying "logged ✓, marked urgent". No new app to
   teach anyone; the unified inbox becomes the intake for *everything*.

**Admin UI:** kanban columns = status, drag cards between them —
`@dnd-kit` is already a dependency (cruise gallery editor uses it), so
the drag-and-drop plumbing exists. Card: photo, boat, severity chip,
age, assignee, cost. Filters per boat. Done column asks for cost →
feeds the finance layer (§5) as a cost row.

**The single-source-of-truth synergies (why this belongs in the system
rather than Trello):**
- **Blocking issue → availability proposal.** Severity 'blocking' on
  Diana → agent immediately proposes blocking Diana's FareHarbor slots
  for the affected dates + drafts reschedule messages for already-booked
  guests (weather-playbook machinery reused verbatim, different trigger).
  Trello can't ground a breakdown in tomorrow's bookings; the truth can.
- **Engine-hours service intervals for free.** Bookings know each
  cruise's duration per boat → cumulative engine hours ≈ sum of booked
  hours → "Curaçao passed ~200h since last service" becomes a proposal,
  no logging required from anyone.
- **Recurrence detection.** `recurrence_of` chains let the agent say
  "bow thruster issue #3 in 10 weeks — €180 in repairs; consider
  replacement (€450)". Repairs stop being amnesiac.
- **Parts → stock.** A repair consuming spare parts decrements stock
  items; reorder proposals (§3) cover spares the same as prosecco.

**Build size:** table + QR report page + kanban tab ≈ 1 week (Stage-1,
human-powered). The agent behaviors are later proposal kinds on top.

---

## 10. What the equivalent human labor would cost (the business case)

Assumptions: Dutch employer cost for office/ops staff ≈ €25–35/h all-in
(salary + employer charges). Season ≈ Apr–Oct. Hours are estimates of
the work the system covers — the same work Beer historically did himself.

| Work the system does | Human hrs/wk (season) | Off-season |
|---|---|---|
| Customer support: email + WhatsApp + phone, logging | 10–14 | 3–5 |
| OTA booking emails → check availability → enter → reply | 3–5 | 1 |
| Missed-call chasing, voicemail follow-up | 2–3 | 1 |
| Stock counting coordination + supplier ordering | 2–3 | 1 |
| Rota making, availability chasing, swap handling | 2–4 | 1 |
| Review monitoring + replies + insight gathering | 1–2 | 0.5 |
| Demand watching, ads babysitting, anomaly spotting | 2–3 | 1 |
| Maintenance coordination | 1–2 | 0.5 |
| Bookkeeping prep / monthly close | 1 | 1 |
| **Total** | **~24–37 h/wk** | **~10–12 h/wk** |

Year-averaged ≈ 17–25 h/wk ≈ **0.5–0.65 FTE** ≈ **€1,900–3,200/month
employer cost ≈ €23k–38k/year** — i.e. the system does roughly the work
of a halftime-to-substantial ops employee, year round, without holidays.

Against that: running costs ≈ €50–150/mo (Twilio + WhatsApp conversations
+ AI calls + queue + monitoring) — **15–40× cheaper than the labor it
covers** — plus the build investment (the phases in these two docs).

Honest accounting of what does NOT go away: human-in-the-loop means
judgment time remains — realistically **15–30 min/day of approving and
steering** (the Today screen, §8-A1). The system compresses *execution*
~85–90% on covered tasks; it converts doing-hours into deciding-minutes.

The strategically bigger number than saved cost: **deferred hiring.**
This work profile is exactly the first ops hire a growing tour company is
forced into (€35k+/yr, recruiting risk, management overhead). The system
pushes that hire out by seasons while capacity grows — and when the first
hire does come, they start with an inbox, a board, and an AI staff
instead of a shoebox of processes in the founder's head.

### 10b. The sharper benchmark: a €750/mo remote VA

Fair comparison — a full-time remote assistant (e.g. Nigeria, which is
even on Amsterdam time, UTC+1) at €750/mo who learns the business:

| | Remote VA | The system |
|---|---|---|
| Cash, yr 1 | ~€9,000–11,000 (wage + platform/bonus) | ~€600–1,800 running + the build (Beer's sessions + subscription) |
| Cash, yr 2+ | same again, every year | ~€600–1,800/yr |
| Beer's time | managing + QA: realistically 2–4 h/wk, heavier in the first months of training | approving: 15–30 min/day |
| Coverage | one human: ~40 h/wk, sleeps, sick days, holidays; one pair of hands at Saturday-morning peak (5 WhatsApps + 2 calls + 3 OTA emails at once) | 24/7 intake, parallel by nature; the human only decides |
| Ramp-up | months to learn FareHarbor, boats, brand voice — and the learning **walks out the door** if they leave | playbook + history accumulate as data; never resigns |
| Risk surface | full admin access (refunds, PII, Stripe) to a low-cost contractor — GDPR processor + trust exposure | agents are scoped API clients with audit trails (§1b) |
| Mistake profile | human errors, variable with fatigue/turnover | systematic errors, but every action proposal-gated + logged |
| Speed to start | can start next week | ~2–3 months of phased building |

Honest read: the VA is a *legitimate* option and wins on speed-to-start.
The system wins on cash (≈ €8k+/yr cheaper from year 2), coverage,
zero-churn, and risk. **But the strongest play is that they're not
rivals:** if volume ever justifies a human, a €750 VA *operating the
system* — approving proposals, handling the weird cases — is 3–5× more
productive than one drowning in raw inboxes, can be onboarded from the
playbook in days instead of months, and inherits guardrails instead of
admin keys. Build the system either way; it makes every future human
(Beer included) the supervisor instead of the clerk.
