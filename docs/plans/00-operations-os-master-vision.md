# Off Course Operations OS — Master Vision

**The reference document.** What we're building, why, the rules that keep
it sound, and the phase-by-phase path. Detail lives in:
- `unified-inbox-and-comms.md` — inbox, AI booking agent, WhatsApp/Twilio, voice
- `ai-operations-vision.md` — proposal loop, stock, scheduling, maintenance, finance, cost case

*Distilled from working sessions, June 2026.*

---

## 1. The vision

> Off Course runs on **one system**: a single source of truth (the
> database) with a human-friendly admin on top and, increasingly, an AI
> staff working underneath — reading the truth, proposing actions,
> learning from every human decision. The founder's job shifts from
> *doing the operations* to *judging the proposals* — from clerk to
> captain of the company itself.

In concrete terms, a normal Tuesday in the target state: Beer opens the
**Today screen** with coffee. Overnight, the AI staff confirmed two
GetYourGuide bookings (availability checked against FareHarbor, entered
through the same code path as always), drafted replies to four WhatsApp
questions in the brand voice (three sent unedited yesterday), noticed
prosecco won't survive Saturday's 26 guests and proposed an order,
drafted next week's skipper rota with fairness reasoning, and flagged
that Saturday's forecast shows rain at 14:00 with a ready-made reschedule
plan. Beer taps approve five times, edits one reply, rejects the rota
swap and drags one shift. Eight minutes. The boats, meanwhile, are the
actual job.

## 2. The five rules (decided in this chat — do not erode)

1. **Single source of truth.** Supabase Postgres holds every domain's
   facts. Slack, WhatsApp, email, spreadsheets are *interfaces*; a
   spreadsheet is an export, never an input. No fact lives only in a
   chat thread.
2. **AI proposes, humans decide.** Every agent writes a *proposal* with
   reasoning and cited source rows. Humans approve / edit / reject — and
   that decision is recorded, becoming the training signal. Autonomy is
   earned per proposal-kind via a trust ladder (always-ask →
   auto-with-undo → auto), promoted from a scoreboard, never from vibes.
3. **Agents are API clients, never UI users.** No bot ever clicks around
   the admin. Agents are backend jobs calling the same `lib/` functions
   and `/api/admin/*` routes the human buttons call — same validation,
   same money math, same audit trail, own scoped identity.
4. **Human-powered UI first.** Every domain gets real tables and a manual
   screen before it gets an agent. The humans battle-test the exact code
   paths the agents inherit. (Manual rota before AI rota; QR stock counts
   before order proposals.)
5. **History is append-only where history is the value.** Counts,
   messages, proposals, shifts, repairs: never UPDATE away the past —
   it's what the AI learns from and what recurrence detection reads.

## 3. The operating model

```
SIGNAL                       PROPOSAL                    DECISION
new email · low stock ┌─────────────────────┐   ┌─────────────────────┐
rota due · weather    │ Agent reads the DB,  │   │ Human: approve/edit/ │
anomaly · review      │ drafts action +      │──▶│ reject — Today screen│
                      │ reasoning + sources  │   │ Slack button, phone  │
                      └─────────────────────┘   └──────────┬──────────┘
                               ▲                           │ executes via
                               │  outcome recorded         ▼ the SAME api
                      ┌────────┴────────────────────────────────┐
                      │ agent_proposals: kind · payload · edits  │
                      │ · outcome → retrieval for next proposal  │
                      └─────────────────────────────────────────┘
```

Self-learning = three honest mechanisms, no magic: (1) context (brand
voice + customer data), (2) **retrieval** of similar past approved
decisions via pgvector in the same database, (3) periodically distilled
playbooks the humans can read and correct.

## 4. Domain map

| Domain | Today | Target | Detail |
|---|---|---|---|
| Customer comms | Gmail + personal WhatsApp + phone, scattered | Unified inbox: email/WhatsApp/voice in one threaded UI, AI drafts, translations | inbox plan §8 |
| OTA bookings (GYG/TripAdvisor/Withlocals) | Manual email reading + entry | AI parses → checks FH availability → one-tap confirm via existing book endpoint | inbox plan §5 |
| Phone | Personal number | Business number: forwarding backbone + voicemail transcripts + callback trick + missed-call → WhatsApp | inbox plan §7 |
| Stock & ordering | Memory + shopping runs | QR counts (30s at the dock) → consumption model → order proposals → supplier sends | ops plan §3 |
| Skipper scheduling | Ad hoc | Manual rota → AI fairness rota → demand-sized staffing | ops plan §4 |
| Maintenance | WhatsApp chaos / memory | Kanban board; captains report via QR/WhatsApp/Slack; blocking issues auto-propose availability blocks; engine-hours from bookings | ops plan §9 |
| Demand & marketing | Gut + Google Ads CLI | Forecasts (season/weekday/weather) feeding rota, availability, ad spend; anomaly watchdog | ops plan §4/§8 |
| Finance | Stripe + bookkeeper | Cost rows + monthly close export + margin watchdog | ops plan §5 |

## 5. Realization — phase by phase

Each phase is independently shippable and valuable; "done" criteria
keep us honest. Calendar assumes part-time founder + AI-assisted dev.

**Phase 0 — Foundation (≈1 wk + paperwork clock-time) — gates everything**
Queue (Inngest), Sentry, `webhook_logs`, webhook verifiers, Slack App
upgrade (events + buttons). In parallel from day 1: Twilio number,
WhatsApp Business verification, template approvals.
*Done when: a test webhook → queue job → retried on failure → Slack
alert on dead-letter, end to end.*

**Phase 1 — Unified inbox, human-powered (≈2 wks)**
contacts/conversations/messages tables, `/admin/inbox` three-pane UI,
Supabase Realtime, Gmail ingestion (2-min poll), reply via Gmail.
*Done when: a customer email and its reply both happen entirely in the
admin, live-updating.*

**Phase 2 — First agent: OTA bookings (≈1.5 wks)**
Classifier + extractor (zod-strict), `ota_product_mappings`,
`agent_proposals`, proposal cards, Slack pings; confirm executes the
existing book endpoint. **Shadow mode for 2 weeks before live.**
*Done when: a real GYG email becomes a confirmed FH booking with one
human tap, and the shadow-mode report reads ≥90% extraction accuracy.*

**Phase 3 — WhatsApp + Voice (≈2.5 wks)**
WhatsApp in/out with 24h-window logic and status ticks; voice forwarding
with whisper screening, voicemail transcripts, callback click-to-call,
TwiML-bin fallback; missed-call → WhatsApp template.
*Done when: Beer's phone rings for a customer call with the site
DOWN (fallback test), and a WhatsApp thread shows ✓✓ ticks.*

**Phase 4 — Ops domains, human-powered (≈3 wks, order by pain)**
Stock tables + QR count pages · manual rota + availability links +
assignment WhatsApps · maintenance kanban + QR/WhatsApp/Slack intake.
*Done when: a skipper has counted stock, seen their shift, and reported
a breakdown — all from their phone, no training session needed.*

**Phase 5 — The learning layer (≈2 wks)**
pgvector retrieval over approved replies; AI-draft button; playbook
distillation job; **Today screen**; agent scoreboard + outcome tracking.
*Done when: drafts measurably improve (unedited-send % rising) and the
scoreboard renders per-agent stats.*

**Phase 6 — More agents on existing rails (≈1 wk each, any order)**
Stock-order proposals · fairness rota proposals · weather playbook ·
anomaly watchdog · review mining · maintenance availability-block
proposals. Each: shadow mode → always-ask → ladder.

**Phase 7 — Intelligence & finance (later)**
Demand forecasts → staffing/ads/availability · cost rows + monthly
close · margin watchdog · autonomy promotions per the scoreboard.

## 6. Extensions (where the vision can grow)

- **Customer-facing concierge.** The same truth + playbook that powers
  internal drafts can answer customers *directly* on the website ("is
  Saturday sunset available for 6?") — with booking handoff into the real
  flow. Natural once draft quality is proven internally; the trust ladder
  applies to customer-facing autonomy too.
- **Dynamic pricing proposals.** Demand forecast + utilization →
  "Saturday sunset slots sell out 9 days ahead; propose +€20 on the last
  two slots / open an extra departure." Proposal-gated like everything.
- **Fleet expansion playbook.** The OS makes a third boat's *operational*
  marginal cost near zero: rota, stock, maintenance, comms all scale by
  adding rows. The constraint becomes capital + skippers, not founder
  hours — which is the point.
- **Market expansion without staff.** 7 locales already in the codebase +
  AI translation in the inbox = serving German/French guests natively,
  no multilingual hire.
- **Partner/B2B automation.** The partner portal + settlements already
  exist; extend the proposal loop to partner ops (auto-drafted
  settlement summaries, partner-specific availability holds).
- **"Off Course OS" as a product.** Every small tour operator (boats,
  bikes, walking tours) drowns in exactly this work. If the OS proves
  itself for seasons, it is itself a sellable product — opinionated ops
  software with an AI staff, by operators for operators. Not a goal now;
  an option the architecture keeps open by staying clean (rule 3 makes
  the system white-labelable: the logic layer has no Off-Course-specific
  UI assumptions).

## 7. Possible outcomes (and the honest risks)

**Time outcome.** Founder ops drop from ~3–5 h/day (season) to
~15–30 min of judgment. The €23k–38k/yr labor equivalent (ops plan §10)
is covered for ~€1–2k/yr running cost.

**Scale outcome.** Grow bookings/boats without the first ops hire; when
a human IS added (€750 VA or local), they operate the system —
onboarded in days from the playbook, 3–5× more productive, no admin keys.

**Asset outcome.** A tour company whose processes are *data and code*
rather than founder memory is materially more sellable/franchisable —
the buyer acquires an operating system, not a dependency on Beer.

**Product outcome (optional).** §6 last bullet — the OS as the second
business.

**Risks, named so we can guard them:**
- *Data discipline erosion* — one "quick spreadsheet" or Slack-only
  process and the truth forks. Guard: rule 1, reviewed at every feature.
- *Over-trusting agents early* — an unearned promotion up the ladder.
  Guard: shadow mode mandatory, scoreboard-gated promotions, irreversible
  actions human-gated forever.
- *Building AI before tables* — tempting, hollow. Guard: rule 4.
- *Founder-as-developer dependency* — the system itself needs care.
  Guard: the existing discipline (tests on logic, feature docs, audit
  cadence) is what makes the next developer/AI session productive;
  keep it.
- *Vendor shifts* (Twilio/Meta pricing, model changes). Guard: provider
  logic isolated in `lib/` modules; proposals/playbooks are portable
  data.

## 8. How we'll know it's working (metrics, reviewed monthly)

- Founder ops minutes/day (the number this whole thing exists to shrink)
- % of AI drafts sent unedited · % proposals approved without edit
- Median first-response time to customers (target: minutes, 24/7)
- Stock-outs per season (target: 0) · rota disputes (target: ~0)
- Time from breakdown report → fix planned
- Revenue per available boat-hour (the scale metric)
- Scoreboard per agent kind: approval %, accuracy, incidents

## 9. Open decisions (current)

The six from the inbox plan (§10: WhatsApp number, Gmail account, ping
targets, call routing, v1 autonomy confirmation, Twilio-vs-Meta) — plus:
which Phase-4 domain first (stock, rota, or maintenance — pick by
current pain), and whether captains' natural habitat is WhatsApp or
Slack (drives which intake ships first).
