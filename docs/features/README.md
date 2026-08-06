# Feature Documentation Index

One file per track or major feature. Written before every PR and kept up to date.

| Feature | File | Track | Status |
|---------|------|-------|--------|
| Core setup + infrastructure | [track-a-core-setup.md](track-a-core-setup.md) | A | done |
| Public pages + SEO | [track-b-public-pages.md](track-b-public-pages.md) | B | done |
| Outscraper Reviews (Google + TripAdvisor) | [outscraper-reviews.md](outscraper-reviews.md) | — | done |
| ~~Google Reviews (OAuth)~~ — replaced by Outscraper | [google-reviews.md](google-reviews.md) | — | superseded |
| Partner-invoiced listings (Webikeamsterdam) | [partner-invoiced-listings.md](partner-invoiced-listings.md) | — | done |
| Image optimization pipeline (Sharp + AVIF + Gemini) | [image-optimization.md](image-optimization.md) | — | done |
| Google Ads conversion tracking (server-side) | [google-ads-conversion-tracking.md](google-ads-conversion-tracking.md) | — | done |
| Google Ads architecture overview (handoff/blueprint) | [google-ads-architecture-overview.md](google-ads-architecture-overview.md) | — | done |
| Google Ads campaign management (create + control) | [google-ads-campaign-management.md](google-ads-campaign-management.md) | — | done |
| Google Ads admin dashboard (monitor & maintain) | [google-ads-dashboard.md](google-ads-dashboard.md) | — | done |
| AI referrals tracking (ChatGPT/Perplexity/Gemini citations) | [ai-referrals-tracking.md](ai-referrals-tracking.md) | — | done |
| WhatsApp click tracking (button usage analytics) | [whatsapp-click-tracking.md](whatsapp-click-tracking.md) | — | done |
| Admin performance (cache + prefetch + parallel queries + images) | [admin-performance.md](admin-performance.md) | — | done |
| Codebase refactoring plan | [codebase-refactoring-plan.md](codebase-refactoring-plan.md) | — | planned |
| Headless WordPress blog (WP SEO AI) | [wordpress-blog.md](wordpress-blog.md) | — | done |
| Payment flow hardening (iDEAL recovery, auto-refund, polling confirmation) | [payment-flow-hardening.md](payment-flow-hardening.md) | D | done |
| Booking claim mutex (one payment → one FareHarbor booking) | [booking-claim-mutex.md](booking-claim-mutex.md) | D | done |
| Synchronous-card self-collision fix (sync card/wallet false "PAID BUT NO BOOKING") | [sync-card-self-collision-fix.md](sync-card-self-collision-fix.md) | D | done |
| VAT invoice PDF (auto-attached to confirmation email) | [vat-invoice-pdf.md](vat-invoice-pdf.md) | D | done |
| Attribution & source tracking (cookies → PI → booking → Google Ads) | [attribution-source-tracking.md](attribution-source-tracking.md) | — | done |
| Withlocals reviews sync (weekly import, dedup, admin tab, frontend) | [withlocals-reviews.md](withlocals-reviews.md) | — | done |
| Shared-cruise multi-ticket pricing + adults-only extras | [shared-cruise-pricing.md](shared-cruise-pricing.md) | D | done |
| Admin booking quoteId fix + FareHarbor webhook duplicate-row fix | [admin-booking-quoteid-and-webhook-dedup-fix.md](admin-booking-quoteid-and-webhook-dedup-fix.md) | — | done |
| Catering order auto-send (7-day window) | [catering-auto-send.md](catering-auto-send.md) | — | done |
| Partner-invoice auth gate fix (Webikeamsterdam checkout regression) | [partner-invoice-auth-gate-fix.md](partner-invoice-auth-gate-fix.md) | — | done |
| "Invoice later" admin booking (pick a partner directly) | [invoice-later-admin-booking.md](invoice-later-admin-booking.md) | — | done |
| Admin bookings search + Planning week view | [admin-bookings-search-and-planning.md](admin-bookings-search-and-planning.md) | — | done |
| Special-event cruise listings (Pride Amsterdam 2026) | [special-event-listings.md](special-event-listings.md) | — | done |
| Kasboek payout pipelines (Viator/GetYourGuide/BoatLocal/Withlocals/Click&Boat/GetMyBoat/Barqo/Revolut/Zettle/FareHarbor) + BTW dashboard | [kasboek-payout-pipelines.md](kasboek-payout-pipelines.md) | — | done |
| Customer chat & unified inbox (webchat phase 1) | [customer-chat-inbox.md](customer-chat-inbox.md) | — | done |
| Ghost shadow AI (proposals, ops drafters, cost meter) | [ghost-shadow-ai.md](ghost-shadow-ai.md) | — | done |
| Ghost inbox co-pilot (P0: act from the inbox) | [ghost-inbox-copilot.md](ghost-inbox-copilot.md) | — | done |
| Maintenance agent (Slack → priority → photo → technician email) | [maintenance-agent.md](maintenance-agent.md) | — | done |
| Storage / Stock agent (QR count → low-stock → supplier reorder email) | [stock-agent.md](stock-agent.md) | — | done |
| Notification Center (Slack catalog + message log + toggles) | [notification-center.md](notification-center.md) | — | done |
| Booking double-create guard (PaymentIntent claim) | [booking-double-create-guard.md](booking-double-create-guard.md) | — | done |
| Observability hardening + money-path tests | [observability-hardening.md](observability-hardening.md) | — | done |
| AI Operations Engine — fase 1 + gastcontact (ops_events, profiles, operations optimizer, auto shift-sync, guest move requests) | [ai-operations-engine.md](ai-operations-engine.md) | — | done |
| Gmail inbox integration (email as a Ghost-drafted channel, poll + threaded send, catering supplier auto-confirmation) | [gmail-inbox-integration.md](gmail-inbox-integration.md) | — | done |
| WhatsApp inbox channel (Twilio Sandbox, webhook ingestion, Ghost drafting, outbound send) | [whatsapp-twilio-integration.md](whatsapp-twilio-integration.md) | — | sandbox (pending Meta verification) |
| Voice inbox channel (Twilio: ring browser softphone + phone simultaneously, voicemail + transcription, outbound calling) | [voice-twilio-integration.md](voice-twilio-integration.md) | — | done |
| OTA notification emails (Withlocals/GetMyBoat: booking-ref grouping, availability check, Chat/OTA sidebar filter, co-pilot cards) | [ota-notifications.md](ota-notifications.md) | — | done (one-click auto-booking from a confirmed OTA email not built yet) |
| Inbox AI summaries (Haiku one-line email summaries + real availability icon) | [inbox-ai-summaries.md](inbox-ai-summaries.md) | — | done |
