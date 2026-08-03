import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.0';
import { corsHeaders } from '../_shared/cors.ts';

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
    const receiptTotal = booking.receipt_total || 0;
    const receiptTotalDisplay = booking.receipt_total_display || '0.00';
    const currency = booking.company?.currency || 'eur';
    const status = booking.status || 'booked';

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

    const { data: existing } = await supabase
      .from('bookings')
      .select('id')
      .eq('booking_uuid', bookingUuid)
      .maybeSingle();

    if (existing) {
      // App-owned booking — enrich with the raw FareHarbor payload only.
      const { data, error } = await supabase
        .from('bookings')
        .update({ raw_payload: booking })
        .eq('id', existing.id)
        .select()
        .single();
      bookingData = data;
      bookingError = error;
    } else {
      // No app row — genuinely external/affiliate booking; this webhook is its
      // sole record. Keep booking_id = FareHarbor numeric pk as the natural key
      // so repeated webhooks for the same external booking update in place.
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
