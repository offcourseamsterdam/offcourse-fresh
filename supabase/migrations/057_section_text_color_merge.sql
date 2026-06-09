-- Atomic per-role merge for homepage_section_styles.text_colors.
--
-- Why: the admin saves one colour role at a time (h2 / h3 / body). The old route
-- did a read-modify-write of the whole `text_colors` JSON, so two saves fired in
-- quick succession could race — the second read stale data and clobbered the
-- first (e.g. setting h2, h3, body fast lost h3). Doing the merge inside a single
-- UPDATE makes Postgres serialize on the row, so concurrent saves can't clobber.
--
--   p_value = a #hex string  → set/overwrite that role
--   p_value = null           → remove that role (reset to coded default)
create or replace function set_section_text_color(p_section text, p_role text, p_value text)
returns homepage_section_styles
language sql
as $$
  insert into homepage_section_styles (section_key, text_colors, updated_at)
  values (
    p_section,
    case when p_value is null then '{}'::jsonb else jsonb_build_object(p_role, p_value) end,
    now()
  )
  on conflict (section_key) do update set
    text_colors = case
      when p_value is null then homepage_section_styles.text_colors - p_role
      else homepage_section_styles.text_colors || jsonb_build_object(p_role, p_value)
    end,
    updated_at = now()
  returning *;
$$;
