-- Amsterdam Knowledge Graph — the structured, owned memory of the city that
-- grounds blog generation AND feeds schema.org markup, so LLMs (ChatGPT,
-- Perplexity, Gemini) have a precise, interconnected source to cite.
--
-- Two tables only, on purpose. A knowledge graph is really just "things" and
-- "the connections between them":
--   * kg_entities      — the THINGS (a neighborhood, a canal, an event, a
--                        person, a historical period)
--   * kg_relationships — the CONNECTIONS (Jordaan --borders--> Prinsengracht)
--
-- We deliberately do NOT reach for a dedicated graph database (Neo4j/RDF).
-- At Off Course's scale two Postgres tables ARE the graph — queryable next to
-- the bookings, no new infrastructure, no new query language to learn.

-- ---------------------------------------------------------------------------
-- kg_entities — one row per "thing" we know about Amsterdam
-- ---------------------------------------------------------------------------
create table if not exists public.kg_entities (
  id uuid primary key default gen_random_uuid(),

  -- Stable, human-readable identifier. Used to link entities, build URLs, and
  -- key the schema.org @id — so it must never change once published.
  slug text not null unique,

  -- The kind of thing this is. NOT a hard DB constraint on purpose: adding a
  -- new type ('museum', 'bridge', 'market') shouldn't need a migration. The
  -- controlled vocabulary is enforced in app code. Known values so far:
  --   'neighborhood' | 'canal' | 'landmark' | 'event' | 'historical_period'
  --   | 'person' | 'bridge' | 'museum' | 'market'
  entity_type text not null,

  name text not null,                 -- display name, e.g. "The Jordaan"

  -- The citable nugget: one or two factual sentences an LLM could quote
  -- verbatim. Dense, specific, no fluff. This is what earns citations.
  summary text,

  -- Longer body — the source of truth in English, written in Off Course voice.
  -- Blog generation reads from here; translations come in a later migration.
  description text,

  -- Structured, machine-readable attributes: the precise facts that make a
  -- source trustworthy. e.g. { "year_established": 1613, "unesco": true,
  -- "coordinates": {"lat": 52.37, "lng": 4.88}, "best_time": "golden hour" }.
  facts jsonb not null default '{}'::jsonb,

  -- Which schema.org type this entity emits as structured data on the page.
  -- Maps an entity straight to markup, e.g. 'Place', 'TouristAttraction',
  -- 'LandmarksOrHistoricalBuildings', 'Event', 'Person'.
  schema_type text,

  -- Provenance / E-E-A-T. An array of where each fact came from, e.g.
  -- [{ "url": "...", "title": "UNESCO canal ring listing", "retrieved": "2026-07-25" }].
  -- Being able to show our sources is itself a trust signal for machines.
  sources jsonb not null default '[]'::jsonb,

  -- Gates whether this entity may surface in public content / markup. Lets us
  -- research and stage facts privately before they go live.
  is_published boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kg_entities_type_idx on public.kg_entities (entity_type);
create index if not exists kg_entities_published_idx on public.kg_entities (is_published);
-- GIN index so we can query inside the facts blob (e.g. "all entities where
-- facts->>'unesco' is true") without scanning every row.
create index if not exists kg_entities_facts_idx on public.kg_entities using gin (facts);

-- ---------------------------------------------------------------------------
-- kg_relationships — one row per directed connection between two entities
-- ---------------------------------------------------------------------------
-- Direction matters: (Jordaan)--borders-->(Prinsengracht). We can still
-- traverse "backwards" by querying on to_entity_id, so we store each edge once.
create table if not exists public.kg_relationships (
  id uuid primary key default gen_random_uuid(),

  from_entity_id uuid not null references public.kg_entities (id) on delete cascade,
  to_entity_id   uuid not null references public.kg_entities (id) on delete cascade,

  -- The verb. Free text for flexibility; app code holds the vocabulary. e.g.
  --   'located-in' | 'borders' | 'runs-through' | 'has-landmark'
  --   | 'happens-on' | 'built-in' | 'associated-with' | 'near'
  relation_type text not null,

  -- Optional qualifier ON the relationship itself, e.g. { "since_year": 1889 }
  -- or { "note": "quietest at dawn" }.
  facts jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  -- No duplicate edges, and no entity pointing at itself.
  constraint kg_relationships_unique unique (from_entity_id, relation_type, to_entity_id),
  constraint kg_relationships_no_self_loop check (from_entity_id <> to_entity_id)
);

create index if not exists kg_relationships_from_idx on public.kg_relationships (from_entity_id);
create index if not exists kg_relationships_to_idx   on public.kg_relationships (to_entity_id);
create index if not exists kg_relationships_type_idx on public.kg_relationships (relation_type);

-- ---------------------------------------------------------------------------
-- RLS — public reads published facts (same gate as cruise_listings); all
-- writes go through the service role (admin / generation pipeline).
-- ---------------------------------------------------------------------------
alter table public.kg_entities enable row level security;
alter table public.kg_relationships enable row level security;

create policy "kg_entities_public_read" on public.kg_entities
  for select using (is_published = true);

create policy "kg_entities_service_all" on public.kg_entities
  for all to service_role using (true);

-- Edges carry nothing sensitive on their own, so they're publicly readable;
-- writes stay service-role only.
create policy "kg_relationships_public_read" on public.kg_relationships
  for select using (true);

create policy "kg_relationships_service_all" on public.kg_relationships
  for all to service_role using (true);

-- Reuse the shared updated_at trigger function defined in 003_cruise_listings.
create trigger kg_entities_updated_at
  before update on public.kg_entities
  for each row execute function public.set_updated_at();
