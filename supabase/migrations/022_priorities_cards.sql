-- Priorities section cards (homepage "We Got Our Priorities Straight")
-- Stores the 5 polaroid cards with images, titles, and descriptions.

CREATE TABLE priorities_cards (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  image_url   text NOT NULL DEFAULT '',
  alt_text    text DEFAULT '',
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  rotate      text NOT NULL DEFAULT 'rotate-0',
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

-- Public can read, only service role (API routes) can write
ALTER TABLE priorities_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_select_priorities_cards"
  ON priorities_cards FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "service_all_priorities_cards"
  ON priorities_cards FOR ALL
  TO service_role
  USING (true);

-- Seed with current hardcoded values
INSERT INTO priorities_cards (image_url, alt_text, title, body, rotate, sort_order) VALUES
  ('', 'Relaxing on board', 'kick off your shoes', 'No performance, just you being you. Come as you are and stay that way.', '-rotate-2', 0),
  ('', 'Drinks on board', 'you know where the fridge is', 'Cold beer, local wine, fresh juice, and sparkling water. Help yourself – this is your floating living room.', 'rotate-1', 1),
  ('', 'Hidden canal', 'off the beaten canal', 'We take the scenic route through quieter waters, away from the tourist crowds and into Amsterdam''s hidden corners.', 'rotate-2', 2),
  ('', 'Amsterdam canal life', 'we drift different', 'Local stories, hidden quirks, and personal tales about our life in Amsterdam. We''ll point out our favourite spots throughout the city.', '-rotate-1', 3),
  ('', 'Welcome aboard', 'we take you as you are', 'Good vibes. Chill people. & the daily struggles. No need to impress – you''re already invited in.', 'rotate-1', 4);
