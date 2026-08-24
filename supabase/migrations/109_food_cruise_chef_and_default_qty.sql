-- 109_food_cruise_chef_and_default_qty.sql
-- Support for "private food cruise" listings (e.g. Curaçao Jamaican Buffet Cruise),
-- a pattern that will recur for future chef-led food cruises.

-- Chef/food-host profile, shown in a "The Food" column next to "The Boat" on the
-- listing detail page when a listing has exactly one boat and a food extra.
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS chef_name text,
  ADD COLUMN IF NOT EXISTS chef_bio text,
  ADD COLUMN IF NOT EXISTS chef_photo_url text,
  ADD COLUMN IF NOT EXISTS chef_photo_asset_id UUID REFERENCES image_assets(id) ON DELETE SET NULL;

-- Opt-in flag for a per-person-pick counter extra (min_people set) to default its
-- quantity to the booking's guest count as soon as it's known, rather than requiring
-- an explicit tap — e.g. a cruise's headline buffet, where "everyone eats" is the
-- sane assumption. Customer can still lower it (kids not eating, etc.) or remove it
-- entirely. Defaults false so every existing per-person-pick extra (Cheese Platter,
-- Charcuterie Platter, Brunch, Fruit Platter, ...) keeps its current opt-in behavior.
ALTER TABLE extras
  ADD COLUMN IF NOT EXISTS default_to_guest_count boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN extras.default_to_guest_count IS
  'Only meaningful on a per_person_cents extra with min_people set. When true, the booking flow pre-fills its quantity to the current guest count (floored at min_people) the first time extras load, instead of leaving it at 0 until the customer taps it.';
