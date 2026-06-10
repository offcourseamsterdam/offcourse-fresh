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
