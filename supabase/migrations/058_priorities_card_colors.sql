-- Per-card Polaroid frame colour + heading (title) colour for the homepage
-- "We Got Our Priorities Straight" cards. NULL = use the coded default.
alter table priorities_cards
  add column if not exists polaroid_color text,
  add column if not exists title_color text;
