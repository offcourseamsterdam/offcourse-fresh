-- Boats table — one row per physical boat
create table if not exists boats (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  built_year   integer,
  max_guests   integer,
  engine_type  text not null default 'Quiet electric engine',
  description  text,
  quote        text,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- Boat images — multiple per boat, grouped by state
create table if not exists boat_images (
  id         uuid primary key default gen_random_uuid(),
  boat_id    uuid not null references boats(id) on delete cascade,
  state      text not null check (state in ('open', 'covered', 'interior')),
  image_url  text not null,
  alt        text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- RLS
alter table boats enable row level security;
alter table boat_images enable row level security;

create policy "Public can read active boats"
  on boats for select using (active = true);

create policy "Admins can manage boats"
  on boats for all
  using (exists (
    select 1 from user_profiles where id = auth.uid() and role = 'admin'
  ));

create policy "Public can read boat images"
  on boat_images for select using (true);

create policy "Admins can manage boat images"
  on boat_images for all
  using (exists (
    select 1 from user_profiles where id = auth.uid() and role = 'admin'
  ));

-- Seed: Diana and Curaçao
insert into boats (name, slug, built_year, max_guests, engine_type, description, quote, sort_order)
values
  ('Diana',   'diana',   1915, 8,  'Quiet electric engine', 'For now, our fleet consists of one. She''s a beautiful, classic saloon boat from 1920, fully restored with love and powered by a silent electric engine. No fumes, no noise — just the soft sound of water.', null, 0),
  ('Curaçao', 'curacao', 1951, 12, 'Quiet electric engine', null, 'mooie boot', 1);

-- Indexes
create index boat_images_boat_id_idx on boat_images (boat_id, state, sort_order);
