-- Zettle (PayPal Point of Sale) onboard card/cash sales, one row per calendar
-- month. Unlike Viator/GetYourGuide/BoatLocal there's no emailed document to
-- parse — Zettle has no monthly report export we can rely on, so the figures
-- are read straight off the my.zettle.com "Verkoopdetails" page and saved here.
--
-- Two cash figures on purpose: `cash_zettle_cents` is what Zettle itself
-- reports for the month, `cash_counted_cents` is Beer's own physical count.
-- The whole reason Zettle matters to the kasboek is being able to verify the
-- second against the first — the difference is derived in code, not stored.
--
-- All money is in integer cents. `month` is the first day of the month (a date)
-- and is unique, so re-saving a month updates it in place rather than
-- duplicating — the read-off-the-page sync is safe to run twice.
CREATE TABLE IF NOT EXISTS zettle_monthly_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL UNIQUE,

  -- Totals (Verkopen per verkoopkanaal + top summary)
  total_incl_vat_cents integer,
  total_excl_vat_cents integer,
  sale_count integer,

  -- BTW-uitsplitsing (Totale verkopen per btw-tarief)
  vat9_excl_cents integer,
  vat9_vat_cents integer,
  vat9_incl_cents integer,
  vat21_excl_cents integer,
  vat21_vat_cents integer,
  vat21_incl_cents integer,
  total_vat_cents integer,

  -- Kaart, reader (card). Surcharge stored as a positive magnitude of the fee;
  -- net = gross - surcharge. PayPal charges no BTW on the surcharge itself.
  card_gross_cents integer,
  card_surcharge_cents integer,
  card_net_cents integer,

  -- Contant (cash). `zettle` = what Zettle reports, `counted` = Beer's own
  -- physical count (nullable — filled in by hand, not from the page).
  cash_zettle_cents integer,
  cash_counted_cents integer,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Admin-only table: no anon access. Writes go through the API route (service
-- role), same as the other finance tables.
ALTER TABLE zettle_monthly_sales ENABLE ROW LEVEL SECURITY;
