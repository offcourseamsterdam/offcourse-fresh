<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:partner-invoicing-rules -->
# Partner Invoicing & Commission Domain Rules

1. **Commission Calculation on Net Base Only**:
   - Partner commission is calculated strictly over the **kale boothuur excl. 9% BTW**: `baseAmountCents / 1.09`.
   - Never apply commission to VAT, tourist tax (`cityTaxCents`), or extras (drinks/catering). Extras and city tax are passed through at 100%.

2. **Confirmation Email PDF Suppression**:
   - For bookings where `isInternal || isStripeInvoice || bookingSource === 'invoice_later' || bookingSource === 'partner_invoice'`, suppress static invoice PDF generation in `sendConfirmationEmail` by setting `baseAmountCents: null`. Never send a "Paid €0" static invoice to B2B customers.

3. **Stripe B2B Partner Invoicing (Partnerkorting)**:
   - When deducting partner commission on a single invoice, treat it as **Partnerkorting** (9% BTW discount), not an external agency commission (which would carry 21% BTW if billed separately).
   - The gross deduction on an inclusive-VAT invoice is `-Math.round(commissionAmountCents * 1.09)`.
   - Always format the line item description to display both the ex-BTW and incl-BTW figures:
     `Partnerkorting <PartnerName> (<Rate>%): -€<NetCommission> ex BTW (-€<GrossReduction> incl. 9% BTW)`
<!-- END:partner-invoicing-rules -->

