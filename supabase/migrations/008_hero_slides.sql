-- Hero slides for the homepage polaroid carousel
create table if not exists hero_slides (
  id          uuid primary key default gen_random_uuid(),
  src         text not null,
  alt         text not null default '',
  caption     text not null default '',
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Public read
alter table hero_slides enable row level security;
create policy "Public can read active hero slides"
  on hero_slides for select
  using (active = true);

create policy "Admins can manage hero slides"
  on hero_slides for all
  using (
    exists (
      select 1 from user_profiles
      where id = auth.uid() and role = 'admin'
    )
  );

-- Default sort index
create index hero_slides_sort_order_idx on hero_slides (sort_order);
