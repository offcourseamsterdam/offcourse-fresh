-- A second optional decorative Polaroid image (Location section shows two,
-- overlapping). NULL = not shown.
alter table homepage_section_styles
  add column if not exists decoration_image_url_2 text;
