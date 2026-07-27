-- Some months show a "BTW 0%" bucket on Zettle's Verkoopdetails page (seen in
-- August 2025, €20,00) alongside the 9%/21% rows — a 0%-taxed sale (incl = excl,
-- no VAT amount by definition). The original 093 migration only modelled 9%/21%,
-- so without this column the per-month vat9+vat21 excl/incl figures silently
-- don't sum to the month's total for any month with a 0% bucket. `total_vat_cents`
-- is unaffected (read straight off the page's grand total either way), but the
-- raw per-rate breakdown needs this to stay internally consistent.
ALTER TABLE zettle_monthly_sales
  ADD COLUMN IF NOT EXISTS vat0_cents integer;
