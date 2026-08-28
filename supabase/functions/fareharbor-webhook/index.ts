import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';
import { corsHeaders } from '../_shared/cors.ts';
import { categoryFromExperienceName } from '../_shared/category.ts';
import { resolveEndTime } from '../_shared/duration.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const payload = await req.json();
    const headers = Object.fromEntries(req.headers.entries());

    console.log('Received FareHarbor webhook:', JSON.stringify(payload, null, 2));

    // Log the webhook
    const { error: logError } = await supabase
      .from('webhook_logs')
      .insert({
        source: 'fareharbor',
        payload,
        headers,
        processed: false
      });

    if (logError) {
      console.error('Error logging webhook:', logError);
    }

    // Extract booking data
    const booking = payload.booking;
    if (!booking) {
      console.error('No booking data in webhook');
      return new Response(
        JSON.stringify({ error: 'No booking data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const bookingId = booking.pk?.toString();
    const bookingUuid = booking.uuid;
    const externalId = booking.external_id || '';
    const customerName = booking.contact?.name || '';
    const customerEmail = booking.contact?.email || '';
    const customerPhone = booking.contact?.phone || '';
    const tourItemId = booking.availability?.item?.pk?.toString() || '';
    const tourItemName = booking.availability?.item?.name || '';
    const startTime = booking.availability?.start_at || null;
    // FareHarbor sends the departure's END and the customer type in the very
    // same payload — we simply never read them, so every webhook-created row
    // landed with a null end_time and a null customer_type_name. Both matter
    // downstream: end_time is what gives a Planning card its real duration,
    // and customer_type_name ("Diana - 2 Hours") is how the shift generator
    // works out which boat a private cruise is on — without it those bookings
    // are skipped and never get a shift, so they never get a captain.
    const customerTypeName =
      booking.customers?.[0]?.customer_type_rate?.customer_type?.singular ?? null;
    // A PRIVATE cruise's availability is open-ended, so FareHarbor sends
    // end_at === start_at and the real length is in the customer type
    // ("Diana - 2 Hours"). resolveEndTime prefers a genuine availability end
    // (shared cruises) and only falls back to the customer type when there
    // isn't one — otherwise every private booking would land as a zero-length
    // departure, which is exactly what it did.
    const endTime = resolveEndTime(startTime, booking.availability?.end_at || null, customerTypeName);
    const receiptTotal = booking.receipt_total || 0;
    const receiptTotalDisplay = booking.receipt_total_display || '0.00';
    const currency = booking.company?.currency || 'eur';
    // FareHarbor reports cancellation as the boolean `is_cancelled` — there is
    // NO `booking.status` field on the payload (see FHBookingResponse in
    // src/lib/fareharbor/types.ts). Reading `booking.status` therefore always
    // came back undefined and always fell through to 'booked', so a cancelled
    // booking was recorded as live. That is how a guest who rebooked through
    // an OTA ended up on the Planning board twice: the webhook inserted the
    // NEW booking correctly and never learned the OLD one had died.
    const isCancelled = booking.is_cancelled === true;
    const status = isCancelled ? 'cancelled' : 'booked';

    console.log('Extracted booking data:', {
      bookingId,
      externalId,
      customerName,
      customerEmail,
      tourItemName,
      receiptTotal
    });

    // Try to find campaign via session
    let campaignId = null;
    let sessionId = null;

    if (externalId) {
      console.log('Looking up session:', externalId);
      const { data: session } = await supabase
        .from('analytics_sessions')
        .select('id, campaign_slug')
        .eq('id', externalId)
        .single();

      if (session) {
        console.log('Found session:', session);
        sessionId = session.id;

        if (session.campaign_slug) {
          console.log('Looking up campaign:', session.campaign_slug);
          const { data: campaign } = await supabase
            .from('campaigns')
            .select('id')
            .eq('slug', session.campaign_slug)
            .eq('is_active', true)
            .single();

          if (campaign) {
            console.log('Found campaign:', campaign.id);
            campaignId = campaign.id;
          }
        }
      }
    }

    // Reconcile against booking_uuid — the ONE id both this webhook and the main
    // Next.js app agree on for the same FareHarbor booking.
    //
    // Why this changed: the previous version upserted with `onConflict: 'booking_id'`.
    // But the main app writes booking_id = Stripe PaymentIntent id ("pi_…") or the
    // FareHarbor UUID, while THIS webhook writes booking_id = FareHarbor's numeric pk
    // ("359929812"). Those never collide, so the upsert never matched the app's row
    // and inserted a duplicate ("shadow") row for every app booking — double-counting
    // in dashboards. See migration 086_dedupe_shadow_bookings.sql for the cleanup.
    //
    // Ownership model:
    //   * Website / admin bookings are OWNED by the app (it holds the payment truth:
    //     payment_status, stripe id, VAT, attribution). When such a row already exists
    //     for this booking_uuid, we must NOT create a second row and must NOT clobber
    //     its fields — we only attach the full FareHarbor payload for reference.
    //   * Affiliate / external FareHarbor bookings have NO app row — those we insert,
    //     exactly as before, as the sole record.
    let bookingData;
    let bookingError;

    const { data: existingByUuid } = await supabase
      .from('bookings')
      .select('id')
      .eq('booking_uuid', bookingUuid)
      .maybeSingle();

    let existing = existingByUuid;
    let existingMatchedByPk = false;

    // Fallback: bookings the app imports from an OTA notification email
    // (Viator/GetYourGuide — see src/lib/fareharbor/import-booking.ts) never
    // get a booking_uuid stamped, because the notification email only ever
    // gives the numeric FareHarbor pk, never the real UUID. Without this
    // fallback, the match above always misses for them, and every webhook
    // delivery inserts a fresh, permanently-broken duplicate ("shadow") row
    // instead of recognizing the booking the app already imported — the same
    // failure mode 086_dedupe_shadow_bookings.sql cleaned up once, just for a
    // case that predates booking_uuid ever being known. Matches either the
    // clean row's booking_id ("fh_{pk}") or its external_id ("{pk}").
    //
    // Two sequential .eq() lookups instead of one .or() with an interpolated
    // filter string: an .or() built via string concatenation lets bookingId
    // inject extra filter clauses (PostgREST filter syntax has no
    // client-side escaping for values embedded this way), and it also risks
    // matching two DIFFERENT rows at once (external_id is reused by the
    // "no app row" branch below for an unrelated analytics/session id),
    // which would make .maybeSingle() throw instead of resolving cleanly.
    // .eq() always binds the value safely and each lookup only matches on
    // its own column, so a double-match can't happen.
    if (!existing && bookingId) {
      const { data: existingByExternalId } = await supabase
        .from('bookings')
        .select('id')
        .eq('external_id', bookingId)
        .maybeSingle();
      if (existingByExternalId) {
        existing = existingByExternalId;
        existingMatchedByPk = true;
      } else {
        const { data: existingByBookingId } = await supabase
          .from('bookings')
          .select('id')
          .eq('booking_id', `fh_${bookingId}`)
          .maybeSingle();
        if (existingByBookingId) {
          existing = existingByBookingId;
          existingMatchedByPk = true;
        }
      }
    }

    if (existing) {
      // App-owned booking — enrich with the raw FareHarbor payload, and, if we
      // just found it via the pk fallback above, also backfill the real
      // booking_uuid this webhook payload carries — the app's own import
      // couldn't know it yet, and having it fixes fh-consistency's
      // getBooking(uuid) lookup for this booking going forward. Validate the
      // shape before writing it back — booking.uuid comes straight off the
      // webhook payload, so a malformed/unexpected value should never reach
      // the column other code treats as a trustworthy FareHarbor UUID.
      const backfillUuid = existingMatchedByPk && bookingUuid && UUID_RE.test(bookingUuid);
      // Cancellation is the ONE status fact FareHarbor is authoritative about
      // for an app-owned row, so it's the one field we propagate here on top
      // of the payload. Everything else about an app-owned booking (payment,
      // Stripe id, VAT, attribution) still belongs to the app and is never
      // touched. Applied one-way — a cancelled booking is never silently
      // revived from a stale webhook redelivery; a genuine rebooking arrives
      // as its own new booking with its own pk.
      const { data, error } = await supabase
        .from('bookings')
        .update({
          raw_payload: booking,
          ...(backfillUuid ? { booking_uuid: bookingUuid } : {}),
          ...(isCancelled ? { status: 'cancelled' } : {}),
        })
        .eq('id', existing.id)
        .select()
        .single();
      bookingData = data;
      bookingError = error;
    } else {
      // No app row — genuinely external/affiliate booking; this webhook is its
      // sole record. Keep booking_id = FareHarbor numeric pk as the natural key
      // so repeated webhooks for the same external booking update in place.
      // booking_date/category/guest_count are derived from fields already in
      // this same payload (never re-fetched) so this row is actually usable in
      // Planning/Bookings before anyone manually imports it — see
      // categoryFromExperienceName in src/lib/fareharbor/import-booking.ts for
      // the equivalent, main-app-side derivation this mirrors.
      const startAtDate = startTime ? String(startTime).slice(0, 10) : null;
      const category = categoryFromExperienceName(tourItemName);
      const guestCount = Array.isArray(booking.customers) ? booking.customers.length : null;
      const availabilityPk = booking.availability?.pk ?? null;

      const { data, error } = await supabase
        .from('bookings')
        .upsert({
          booking_id: bookingId,
          booking_uuid: bookingUuid,
          external_id: externalId,
          campaign_id: campaignId,
          session_id: sessionId,
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone,
          tour_item_id: tourItemId,
          tour_item_name: tourItemName,
          start_time: startTime,
          end_time: endTime,
          customer_type_name: customerTypeName,
          booking_date: startAtDate,
          category: category,
          guest_count: guestCount,
          fareharbor_availability_pk: availabilityPk,
          receipt_total: receiptTotal,
          receipt_total_display: receiptTotalDisplay,
          currency: currency,
          status: status,
          raw_payload: booking
        }, {
          onConflict: 'booking_id',
          ignoreDuplicates: false
        })
        .select()
        .single();
      bookingData = data;
      bookingError = error;
    }

    if (bookingError) {
      console.error('Error saving booking:', bookingError);

      // Update webhook log with error
      await supabase
        .from('webhook_logs')
        .update({ error: bookingError.message })
        .eq('payload', payload);

      return new Response(
        JSON.stringify({ error: bookingError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Booking saved:', bookingData);

    // Mark webhook as processed
    await supabase
      .from('webhook_logs')
      .update({ processed: true })
      .eq('payload', payload);

    return new Response(
      JSON.stringify({ success: true, booking: bookingData }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in fareharbor-webhook:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
