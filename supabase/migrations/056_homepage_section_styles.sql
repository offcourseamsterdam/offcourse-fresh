-- Per-homepage-section appearance.
--
-- Lets an admin swap each homepage section's background texture and set the
-- colours of its H2 / H3 / body text individually. One row per section.
--
--   background  → { webp, avif, color } for the uploaded texture, or NULL to
--                 fall back to the section's coded default (bg-texture-* class).
--   text_colors → { h2, h3, body } hex strings (any subset); missing keys fall
--                 back to each section's coded default colour.
create table if not exists homepage_section_styles (
  section_key  text primary key,
  background   jsonb,
  text_colors  jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table homepage_section_styles enable row level security;

-- The public homepage reads these on every render; writes go through the
-- service-role admin API only (no public write policy).
create policy "public read homepage_section_styles"
  on homepage_section_styles for select using (true);
