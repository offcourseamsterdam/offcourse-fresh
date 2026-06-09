-- Optional decorative Polaroid image for a homepage section (currently the
-- Location section). NULL = no decoration.
alter table homepage_section_styles
  add column if not exists decoration_image_url text;
