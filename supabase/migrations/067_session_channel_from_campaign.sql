-- Sessions that arrived through a /t/<slug> campaign link had their channel_id
-- resolved from referrer/UTM only (Google ad clicks → "organic", Instagram bio
-- links → "referral"/"direct"), because the campaign's own channel was applied
-- only when the referrer guess came up empty — which it never does.
-- Backfill: the campaign's channel wins. The write path now does the same
-- (src/app/api/tracking/session/route.ts).

UPDATE analytics_sessions s
SET channel_id = c.channel_id
FROM campaigns c
WHERE s.campaign_id = c.id
  AND c.channel_id IS NOT NULL
  AND s.channel_id IS DISTINCT FROM c.channel_id;
