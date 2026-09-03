export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      admin_event_log: {
        Row: {
          context: Json | null
          id: string
          ip: string | null
          kind: string
          message: string
          occurred_at: string
          resolved_at: string | null
          severity: string
          url: string | null
          user_agent: string | null
        }
        Insert: {
          context?: Json | null
          id?: string
          ip?: string | null
          kind: string
          message: string
          occurred_at?: string
          resolved_at?: string | null
          severity: string
          url?: string | null
          user_agent?: string | null
        }
        Update: {
          context?: Json | null
          id?: string
          ip?: string | null
          kind?: string
          message?: string
          occurred_at?: string
          resolved_at?: string | null
          severity?: string
          url?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      agent_proposals: {
        Row: {
          conversation_id: string | null
          created_at: string
          human_edits: Json | null
          id: string
          kind: string
          model: string | null
          outcome: Json | null
          payload: Json
          reasoning: string | null
          reviewed_at: string | null
          status: string
          trigger_message_id: string | null
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          human_edits?: Json | null
          id?: string
          kind: string
          model?: string | null
          outcome?: Json | null
          payload: Json
          reasoning?: string | null
          reviewed_at?: string | null
          status?: string
          trigger_message_id?: string | null
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          human_edits?: Json | null
          id?: string
          kind?: string
          model?: string | null
          outcome?: Json | null
          payload?: Json
          reasoning?: string | null
          reviewed_at?: string | null
          status?: string
          trigger_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_proposals_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_proposals_trigger_message_id_fkey"
            columns: ["trigger_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage: {
        Row: {
          cost_eur_cents: number
          created_at: string
          feature: string
          id: string
          input_tokens: number
          model: string
          output_tokens: number
        }
        Insert: {
          cost_eur_cents: number
          created_at?: string
          feature: string
          id?: string
          input_tokens?: number
          model: string
          output_tokens?: number
        }
        Update: {
          cost_eur_cents?: number
          created_at?: string
          feature?: string
          id?: string
          input_tokens?: number
          model?: string
          output_tokens?: number
        }
        Relationships: []
      }
      ai_usage_alerts: {
        Row: {
          notified_at: string
          threshold_eur: number
        }
        Insert: {
          notified_at?: string
          threshold_eur: number
        }
        Update: {
          notified_at?: string
          threshold_eur?: number
        }
        Relationships: []
      }
      analytics_sessions: {
        Row: {
          browser_name: string | null
          campaign_id: string | null
          campaign_slug: string | null
          channel_id: string | null
          country_code: string | null
          created_at: string | null
          device_type: string | null
          ended_at: string | null
          entry_page: string | null
          exit_page: string | null
          id: string
          ip_address: string | null
          is_bounce: boolean | null
          page_count: number | null
          referrer: string | null
          session_duration: number | null
          started_at: string | null
          updated_at: string | null
          user_agent: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          visitor_id: string
        }
        Insert: {
          browser_name?: string | null
          campaign_id?: string | null
          campaign_slug?: string | null
          channel_id?: string | null
          country_code?: string | null
          created_at?: string | null
          device_type?: string | null
          ended_at?: string | null
          entry_page?: string | null
          exit_page?: string | null
          id: string
          ip_address?: string | null
          is_bounce?: boolean | null
          page_count?: number | null
          referrer?: string | null
          session_duration?: number | null
          started_at?: string | null
          updated_at?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id: string
        }
        Update: {
          browser_name?: string | null
          campaign_id?: string | null
          campaign_slug?: string | null
          channel_id?: string | null
          country_code?: string | null
          created_at?: string | null
          device_type?: string | null
          ended_at?: string | null
          entry_page?: string | null
          exit_page?: string | null
          id?: string
          ip_address?: string | null
          is_bounce?: boolean | null
          page_count?: number | null
          referrer?: string | null
          session_duration?: number | null
          started_at?: string | null
          updated_at?: string | null
          user_agent?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "analytics_sessions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "analytics_sessions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      barqo_bookings: {
        Row: {
          boat_name: string | null
          booking_number: string
          created_at: string
          guest_name: string | null
          id: string
          net_payout_cents: number | null
          price_cents: number
          revenue_vat_rate: number
          trip_date: string | null
          updated_at: string
        }
        Insert: {
          boat_name?: string | null
          booking_number: string
          created_at?: string
          guest_name?: string | null
          id?: string
          net_payout_cents?: number | null
          price_cents: number
          revenue_vat_rate?: number
          trip_date?: string | null
          updated_at?: string
        }
        Update: {
          boat_name?: string | null
          booking_number?: string
          created_at?: string
          guest_name?: string | null
          id?: string
          net_payout_cents?: number | null
          price_cents?: number
          revenue_vat_rate?: number
          trip_date?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      boatlocal_payout_batches: {
        Row: {
          commission_ex_vat_cents: number | null
          created_at: string
          id: string
          invoice_number: string
          issue_date: string | null
          operator_payout_cents: number | null
          period_end: string | null
          period_start: string | null
          raw_filename: string | null
          storage_path: string | null
          total_sales_excl_vat_cents: number | null
          total_sales_incl_vat_cents: number | null
          total_withheld_cents: number | null
          vat_21_cents: number | null
          vat_9_in_payout_cents: number | null
        }
        Insert: {
          commission_ex_vat_cents?: number | null
          created_at?: string
          id?: string
          invoice_number: string
          issue_date?: string | null
          operator_payout_cents?: number | null
          period_end?: string | null
          period_start?: string | null
          raw_filename?: string | null
          storage_path?: string | null
          total_sales_excl_vat_cents?: number | null
          total_sales_incl_vat_cents?: number | null
          total_withheld_cents?: number | null
          vat_21_cents?: number | null
          vat_9_in_payout_cents?: number | null
        }
        Update: {
          commission_ex_vat_cents?: number | null
          created_at?: string
          id?: string
          invoice_number?: string
          issue_date?: string | null
          operator_payout_cents?: number | null
          period_end?: string | null
          period_start?: string | null
          raw_filename?: string | null
          storage_path?: string | null
          total_sales_excl_vat_cents?: number | null
          total_sales_incl_vat_cents?: number | null
          total_withheld_cents?: number | null
          vat_21_cents?: number | null
          vat_9_in_payout_cents?: number | null
        }
        Relationships: []
      }
      boatlocal_payout_lines: {
        Row: {
          batch_id: string
          booking_date: string | null
          created_at: string
          cruise_name: string | null
          ex_vat_cents: number | null
          guest_count: number | null
          guest_name: string | null
          id: string
          incl_vat_cents: number | null
          total_cents: number | null
        }
        Insert: {
          batch_id: string
          booking_date?: string | null
          created_at?: string
          cruise_name?: string | null
          ex_vat_cents?: number | null
          guest_count?: number | null
          guest_name?: string | null
          id?: string
          incl_vat_cents?: number | null
          total_cents?: number | null
        }
        Update: {
          batch_id?: string
          booking_date?: string | null
          created_at?: string
          cruise_name?: string | null
          ex_vat_cents?: number | null
          guest_count?: number | null
          guest_name?: string | null
          id?: string
          incl_vat_cents?: number | null
          total_cents?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boatlocal_payout_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "boatlocal_payout_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      boats: {
        Row: {
          built_year: number | null
          created_at: string
          description: string | null
          description_de: string | null
          description_es: string | null
          description_fr: string | null
          description_nl: string | null
          description_pt: string | null
          description_zh: string | null
          display_order: number
          fareharbor_customer_type_pks: number[] | null
          id: string
          is_active: boolean
          is_electric: boolean
          max_capacity: number | null
          name: string
          photo_alt_text: Json | null
          photo_covered_url: string | null
          photo_interior_url: string | null
          photo_url: string | null
          updated_at: string
        }
        Insert: {
          built_year?: number | null
          created_at?: string
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          display_order?: number
          fareharbor_customer_type_pks?: number[] | null
          id?: string
          is_active?: boolean
          is_electric?: boolean
          max_capacity?: number | null
          name: string
          photo_alt_text?: Json | null
          photo_covered_url?: string | null
          photo_interior_url?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Update: {
          built_year?: number | null
          created_at?: string
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          display_order?: number
          fareharbor_customer_type_pks?: number[] | null
          id?: string
          is_active?: boolean
          is_electric?: boolean
          max_capacity?: number | null
          name?: string
          photo_alt_text?: Json | null
          photo_covered_url?: string | null
          photo_interior_url?: string | null
          photo_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      booking_claims: {
        Row: {
          created_at: string
          payment_intent_id: string
        }
        Insert: {
          created_at?: string
          payment_intent_id: string
        }
        Update: {
          created_at?: string
          payment_intent_id?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          base_amount_cents: number | null
          base_vat_amount_cents: number | null
          base_vat_rate: number | null
          booking_date: string | null
          booking_id: string
          booking_source: string
          booking_uuid: string | null
          campaign_id: string | null
          category: string | null
          catering_confirmed_at: string | null
          catering_email_sent_at: string | null
          catering_thread_id: string | null
          commission_amount_cents: number | null
          created_at: string | null
          currency: string | null
          customer_email: string
          customer_name: string
          customer_phone: string | null
          customer_type_name: string | null
          deposit_amount_cents: number | null
          discount_amount_cents: number
          end_time: string | null
          external_id: string | null
          extras_amount_cents: number | null
          extras_selected: Json | null
          extras_upsell_sent_at: string | null
          extras_vat_amount_cents: number | null
          fareharbor_availability_pk: number | null
          fareharbor_customer_type_rate_pk: number | null
          fh_escalated_at: string | null
          gclid: string | null
          guest_count: number | null
          guest_note: string | null
          id: string
          invoice_number: string | null
          listing_id: string | null
          listing_title: string | null
          no_reschedule_ask: boolean
          no_reschedule_reason: string | null
          partner_id: string | null
          payment_link_expires_at: string | null
          payment_reminder_sent: boolean | null
          payment_status: string | null
          promo_code_id: string | null
          raw_payload: Json | null
          receipt_total: number | null
          receipt_total_display: string | null
          review_sms_phone: string | null
          review_sms_sent_at: string | null
          review_sms_sid: string | null
          session_id: string | null
          start_time: string | null
          status: string | null
          stripe_amount: number | null
          stripe_fee_cents: number | null
          business_profile_id: string | null
          company_address: string | null
          company_kvk: string | null
          company_name: string | null
          company_vat: string | null
          invoice_due_date: string | null
          payment_terms_days: number | null
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_invoice_url: string | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          total_vat_amount_cents: number | null
          tour_item_id: string | null
          tour_item_name: string | null
          traffic_detail: string | null
          traffic_source: string | null
          updated_at: string | null
        }
        Insert: {
          base_amount_cents?: number | null
          base_vat_amount_cents?: number | null
          base_vat_rate?: number | null
          booking_date?: string | null
          booking_id: string
          booking_source?: string
          booking_uuid?: string | null
          campaign_id?: string | null
          category?: string | null
          catering_confirmed_at?: string | null
          catering_email_sent_at?: string | null
          catering_thread_id?: string | null
          commission_amount_cents?: number | null
          created_at?: string | null
          currency?: string | null
          customer_email: string
          customer_name: string
          customer_phone?: string | null
          customer_type_name?: string | null
          deposit_amount_cents?: number | null
          discount_amount_cents?: number
          end_time?: string | null
          external_id?: string | null
          extras_amount_cents?: number | null
          extras_selected?: Json | null
          extras_upsell_sent_at?: string | null
          extras_vat_amount_cents?: number | null
          fareharbor_availability_pk?: number | null
          fareharbor_customer_type_rate_pk?: number | null
          fh_escalated_at?: string | null
          gclid?: string | null
          guest_count?: number | null
          guest_note?: string | null
          id?: string
          invoice_number?: string | null
          listing_id?: string | null
          listing_title?: string | null
          no_reschedule_ask?: boolean
          no_reschedule_reason?: string | null
          partner_id?: string | null
          payment_link_expires_at?: string | null
          payment_reminder_sent?: boolean | null
          payment_status?: string | null
          promo_code_id?: string | null
          raw_payload?: Json | null
          receipt_total?: number | null
          receipt_total_display?: string | null
          review_sms_phone?: string | null
          review_sms_sent_at?: string | null
          review_sms_sid?: string | null
          session_id?: string | null
          start_time?: string | null
          status?: string | null
          stripe_amount?: number | null
          stripe_fee_cents?: number | null
          business_profile_id?: string | null
          company_address?: string | null
          company_kvk?: string | null
          company_name?: string | null
          company_vat?: string | null
          invoice_due_date?: string | null
          payment_terms_days?: number | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          total_vat_amount_cents?: number | null
          tour_item_id?: string | null
          tour_item_name?: string | null
          traffic_detail?: string | null
          traffic_source?: string | null
          updated_at?: string | null
        }
        Update: {
          base_amount_cents?: number | null
          base_vat_amount_cents?: number | null
          base_vat_rate?: number | null
          booking_date?: string | null
          booking_id?: string
          booking_source?: string
          booking_uuid?: string | null
          campaign_id?: string | null
          category?: string | null
          catering_confirmed_at?: string | null
          catering_email_sent_at?: string | null
          catering_thread_id?: string | null
          commission_amount_cents?: number | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
          customer_type_name?: string | null
          deposit_amount_cents?: number | null
          discount_amount_cents?: number
          end_time?: string | null
          external_id?: string | null
          extras_amount_cents?: number | null
          extras_selected?: Json | null
          extras_upsell_sent_at?: string | null
          extras_vat_amount_cents?: number | null
          fareharbor_availability_pk?: number | null
          fareharbor_customer_type_rate_pk?: number | null
          fh_escalated_at?: string | null
          gclid?: string | null
          guest_count?: number | null
          guest_note?: string | null
          id?: string
          invoice_number?: string | null
          listing_id?: string | null
          listing_title?: string | null
          no_reschedule_ask?: boolean
          no_reschedule_reason?: string | null
          partner_id?: string | null
          payment_link_expires_at?: string | null
          payment_reminder_sent?: boolean | null
          payment_status?: string | null
          promo_code_id?: string | null
          raw_payload?: Json | null
          receipt_total?: number | null
          receipt_total_display?: string | null
          review_sms_phone?: string | null
          review_sms_sent_at?: string | null
          review_sms_sid?: string | null
          session_id?: string | null
          start_time?: string | null
          status?: string | null
          stripe_amount?: number | null
          stripe_fee_cents?: number | null
          business_profile_id?: string | null
          company_address?: string | null
          company_kvk?: string | null
          company_name?: string | null
          company_vat?: string | null
          invoice_due_date?: string | null
          payment_terms_days?: number | null
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_url?: string | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          total_vat_amount_cents?: number | null
          tour_item_id?: string | null
          tour_item_name?: string | null
          traffic_detail?: string | null
          traffic_source?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "analytics_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      business_profiles: {
        Row: {
          address_line1: string
          city: string
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          country_code: string | null
          created_at: string
          id: string
          kvk_number: string | null
          notes: string | null
          postal_code: string
          stripe_customer_id: string | null
          updated_at: string
          vat_number: string | null
        }
        Insert: {
          address_line1: string
          city: string
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          kvk_number?: string | null
          notes?: string | null
          postal_code: string
          stripe_customer_id?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Update: {
          address_line1?: string
          city?: string
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          country_code?: string | null
          created_at?: string
          id?: string
          kvk_number?: string | null
          notes?: string | null
          postal_code?: string
          stripe_customer_id?: string | null
          updated_at?: string
          vat_number?: string | null
        }
        Relationships: []
      }
      campaign_clicks: {
        Row: {
          campaign_id: string
          clicked_at: string | null
          id: string
          referrer: string | null
          session_token: string
          user_agent: string | null
        }
        Insert: {
          campaign_id: string
          clicked_at?: string | null
          id?: string
          referrer?: string | null
          session_token: string
          user_agent?: string | null
        }
        Update: {
          campaign_id?: string
          clicked_at?: string | null
          id?: string
          referrer?: string | null
          session_token?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_clicks_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_links: {
        Row: {
          campaign_id: string | null
          commission_percentage: number | null
          commission_type: string
          created_at: string | null
          destination_url: string
          fixed_commission_amount: number | null
          id: string
          investment_amount: number | null
          is_active: boolean | null
          name: string
          partner_id: string
          slug: string
        }
        Insert: {
          campaign_id?: string | null
          commission_percentage?: number | null
          commission_type?: string
          created_at?: string | null
          destination_url: string
          fixed_commission_amount?: number | null
          id?: string
          investment_amount?: number | null
          is_active?: boolean | null
          name: string
          partner_id: string
          slug: string
        }
        Update: {
          campaign_id?: string | null
          commission_percentage?: number | null
          commission_type?: string
          created_at?: string | null
          destination_url?: string
          fixed_commission_amount?: number | null
          id?: string
          investment_amount?: number | null
          is_active?: boolean | null
          name?: string
          partner_id?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_links_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_links_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_sessions: {
        Row: {
          booking_id: string | null
          campaign_id: string
          converted: boolean | null
          first_seen_at: string
          id: string
          last_seen_at: string
          revenue_eur: number | null
          session_token: string
          visitor_token: string
        }
        Insert: {
          booking_id?: string | null
          campaign_id: string
          converted?: boolean | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          revenue_eur?: number | null
          session_token: string
          visitor_token: string
        }
        Update: {
          booking_id?: string | null
          campaign_id?: string
          converted?: boolean | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          revenue_eur?: number | null
          session_token?: string
          visitor_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_sessions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_links"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          category: string
          channel_id: string | null
          created_at: string | null
          id: string
          investment_amount: number | null
          investment_type: string | null
          is_active: boolean | null
          listing_id: string | null
          name: string
          notes: string | null
          partner_id: string | null
          percentage_value: number | null
          settlement_model: string
          slug: string
          updated_at: string | null
        }
        Insert: {
          category: string
          channel_id?: string | null
          created_at?: string | null
          id?: string
          investment_amount?: number | null
          investment_type?: string | null
          is_active?: boolean | null
          listing_id?: string | null
          name: string
          notes?: string | null
          partner_id?: string | null
          percentage_value?: number | null
          settlement_model?: string
          slug: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          channel_id?: string | null
          created_at?: string | null
          id?: string
          investment_amount?: number | null
          investment_type?: string | null
          is_active?: boolean | null
          listing_id?: string | null
          name?: string
          notes?: string | null
          partner_id?: string | null
          percentage_value?: number | null
          settlement_model?: string
          slug?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "cruise_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          display_order: number
          icon: string | null
          id: string
          is_active: boolean
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          display_order?: number
          icon?: string | null
          id?: string
          is_active?: boolean
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      clickandboat_bookings: {
        Row: {
          bank_transfer_date: string | null
          charter_end_date: string | null
          charter_number: string
          charter_start_date: string | null
          created_at: string
          duration_days: number | null
          gross_amount_cents: number | null
          id: string
          listing_title: string | null
          location: string | null
          net_amount_cents: number | null
          raw_filename: string | null
          revenue_vat_rate: number
          updated_at: string
        }
        Insert: {
          bank_transfer_date?: string | null
          charter_end_date?: string | null
          charter_number: string
          charter_start_date?: string | null
          created_at?: string
          duration_days?: number | null
          gross_amount_cents?: number | null
          id?: string
          listing_title?: string | null
          location?: string | null
          net_amount_cents?: number | null
          raw_filename?: string | null
          revenue_vat_rate?: number
          updated_at?: string
        }
        Update: {
          bank_transfer_date?: string | null
          charter_end_date?: string | null
          charter_number?: string
          charter_start_date?: string | null
          created_at?: string
          duration_days?: number | null
          gross_amount_cents?: number | null
          id?: string
          listing_title?: string | null
          location?: string | null
          net_amount_cents?: number | null
          raw_filename?: string | null
          revenue_vat_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          locale: string | null
          name: string
          notes: string | null
          phone_e164: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          locale?: string | null
          name: string
          notes?: string | null
          phone_e164?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          locale?: string | null
          name?: string
          notes?: string | null
          phone_e164?: string | null
        }
        Relationships: []
      }
      conversations: {
        Row: {
          ai_summary: string | null
          assignee_profile_id: string | null
          booking_id: string | null
          channel: string
          contact_id: string
          created_at: string
          id: string
          last_message_at: string
          ota_available: boolean | null
          ota_booking_ref: string | null
          ota_guest_name: string | null
          ota_source: string | null
          ota_status: string | null
          provider_thread_id: string | null
          status: string
          subject: string | null
          unread_count: number
          wa_window_expires_at: string | null
          webchat_token: string
        }
        Insert: {
          ai_summary?: string | null
          assignee_profile_id?: string | null
          booking_id?: string | null
          channel: string
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          ota_available?: boolean | null
          ota_booking_ref?: string | null
          ota_guest_name?: string | null
          ota_source?: string | null
          ota_status?: string | null
          provider_thread_id?: string | null
          status?: string
          subject?: string | null
          unread_count?: number
          wa_window_expires_at?: string | null
          webchat_token?: string
        }
        Update: {
          ai_summary?: string | null
          assignee_profile_id?: string | null
          booking_id?: string | null
          channel?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          ota_available?: boolean | null
          ota_booking_ref?: string | null
          ota_guest_name?: string | null
          ota_source?: string | null
          ota_status?: string | null
          provider_thread_id?: string | null
          status?: string
          subject?: string | null
          unread_count?: number
          wa_window_expires_at?: string | null
          webchat_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_assignee_profile_id_fkey"
            columns: ["assignee_profile_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      cruise_listings: {
        Row: {
          allowed_customer_type_pks: number[] | null
          allowed_resource_pks: number[] | null
          availability_filters: Json | null
          benefits: Json | null
          boat_id: string | null
          booking_cutoff_hours: number | null
          cancellation_policy: Json | null
          category: string | null
          catering_email_recipient: string | null
          chef_bio: string | null
          chef_name: string | null
          chef_photo_asset_id: string | null
          chef_photo_url: string | null
          created_at: string | null
          departure_location: string | null
          description: string | null
          description_de: string | null
          description_es: string | null
          description_fr: string | null
          description_nl: string | null
          description_pt: string | null
          description_zh: string | null
          display_order: number | null
          duration_display: string | null
          faqs: Json | null
          faqs_de: Json | null
          faqs_es: Json | null
          faqs_fr: Json | null
          faqs_nl: Json | null
          faqs_pt: Json | null
          faqs_zh: Json | null
          fareharbor_item_pk: number
          google_maps_url: string | null
          hero_image_asset_id: string | null
          hero_image_url: string | null
          highlights: Json | null
          id: string
          images: Json | null
          inclusions: Json | null
          is_archived: boolean
          is_featured: boolean | null
          is_listed: boolean
          is_published: boolean | null
          max_guests: number | null
          payment_mode: string
          price_display: string | null
          price_label: string | null
          required_partner_id: string | null
          seo_meta_description: string | null
          seo_meta_description_de: string | null
          seo_meta_description_es: string | null
          seo_meta_description_fr: string | null
          seo_meta_description_nl: string | null
          seo_meta_description_pt: string | null
          seo_meta_description_zh: string | null
          seo_title: string | null
          seo_title_de: string | null
          seo_title_es: string | null
          seo_title_fr: string | null
          seo_title_nl: string | null
          seo_title_pt: string | null
          seo_title_zh: string | null
          slug: string
          starting_price: number | null
          tagline: string | null
          tagline_de: string | null
          tagline_es: string | null
          tagline_fr: string | null
          tagline_nl: string | null
          tagline_pt: string | null
          tagline_zh: string | null
          theme_accent_color: string | null
          theme_primary_color: string | null
          title: string
          title_de: string | null
          title_es: string | null
          title_fr: string | null
          title_nl: string | null
          title_pt: string | null
          title_zh: string | null
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          allowed_customer_type_pks?: number[] | null
          allowed_resource_pks?: number[] | null
          availability_filters?: Json | null
          benefits?: Json | null
          boat_id?: string | null
          booking_cutoff_hours?: number | null
          cancellation_policy?: Json | null
          category?: string | null
          catering_email_recipient?: string | null
          chef_bio?: string | null
          chef_name?: string | null
          chef_photo_asset_id?: string | null
          chef_photo_url?: string | null
          created_at?: string | null
          departure_location?: string | null
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          display_order?: number | null
          duration_display?: string | null
          faqs?: Json | null
          faqs_de?: Json | null
          faqs_es?: Json | null
          faqs_fr?: Json | null
          faqs_nl?: Json | null
          faqs_pt?: Json | null
          faqs_zh?: Json | null
          fareharbor_item_pk: number
          google_maps_url?: string | null
          hero_image_asset_id?: string | null
          hero_image_url?: string | null
          highlights?: Json | null
          id?: string
          images?: Json | null
          inclusions?: Json | null
          is_archived?: boolean
          is_featured?: boolean | null
          is_listed?: boolean
          is_published?: boolean | null
          max_guests?: number | null
          payment_mode?: string
          price_display?: string | null
          price_label?: string | null
          required_partner_id?: string | null
          seo_meta_description?: string | null
          seo_meta_description_de?: string | null
          seo_meta_description_es?: string | null
          seo_meta_description_fr?: string | null
          seo_meta_description_nl?: string | null
          seo_meta_description_pt?: string | null
          seo_meta_description_zh?: string | null
          seo_title?: string | null
          seo_title_de?: string | null
          seo_title_es?: string | null
          seo_title_fr?: string | null
          seo_title_nl?: string | null
          seo_title_pt?: string | null
          seo_title_zh?: string | null
          slug: string
          starting_price?: number | null
          tagline?: string | null
          tagline_de?: string | null
          tagline_es?: string | null
          tagline_fr?: string | null
          tagline_nl?: string | null
          tagline_pt?: string | null
          tagline_zh?: string | null
          theme_accent_color?: string | null
          theme_primary_color?: string | null
          title: string
          title_de?: string | null
          title_es?: string | null
          title_fr?: string | null
          title_nl?: string | null
          title_pt?: string | null
          title_zh?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          allowed_customer_type_pks?: number[] | null
          allowed_resource_pks?: number[] | null
          availability_filters?: Json | null
          benefits?: Json | null
          boat_id?: string | null
          booking_cutoff_hours?: number | null
          cancellation_policy?: Json | null
          category?: string | null
          catering_email_recipient?: string | null
          chef_bio?: string | null
          chef_name?: string | null
          chef_photo_asset_id?: string | null
          chef_photo_url?: string | null
          created_at?: string | null
          departure_location?: string | null
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          display_order?: number | null
          duration_display?: string | null
          faqs?: Json | null
          faqs_de?: Json | null
          faqs_es?: Json | null
          faqs_fr?: Json | null
          faqs_nl?: Json | null
          faqs_pt?: Json | null
          faqs_zh?: Json | null
          fareharbor_item_pk?: number
          google_maps_url?: string | null
          hero_image_asset_id?: string | null
          hero_image_url?: string | null
          highlights?: Json | null
          id?: string
          images?: Json | null
          inclusions?: Json | null
          is_archived?: boolean
          is_featured?: boolean | null
          is_listed?: boolean
          is_published?: boolean | null
          max_guests?: number | null
          payment_mode?: string
          price_display?: string | null
          price_label?: string | null
          required_partner_id?: string | null
          seo_meta_description?: string | null
          seo_meta_description_de?: string | null
          seo_meta_description_es?: string | null
          seo_meta_description_fr?: string | null
          seo_meta_description_nl?: string | null
          seo_meta_description_pt?: string | null
          seo_meta_description_zh?: string | null
          seo_title?: string | null
          seo_title_de?: string | null
          seo_title_es?: string | null
          seo_title_fr?: string | null
          seo_title_nl?: string | null
          seo_title_pt?: string | null
          seo_title_zh?: string | null
          slug?: string
          starting_price?: number | null
          tagline?: string | null
          tagline_de?: string | null
          tagline_es?: string | null
          tagline_fr?: string | null
          tagline_nl?: string | null
          tagline_pt?: string | null
          tagline_zh?: string | null
          theme_accent_color?: string | null
          theme_primary_color?: string | null
          title?: string
          title_de?: string | null
          title_es?: string | null
          title_fr?: string | null
          title_nl?: string | null
          title_pt?: string | null
          title_zh?: string | null
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cruise_listings_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cruise_listings_chef_photo_asset_id_fkey"
            columns: ["chef_photo_asset_id"]
            isOneToOne: false
            referencedRelation: "image_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cruise_listings_hero_image_asset_id_fkey"
            columns: ["hero_image_asset_id"]
            isOneToOne: false
            referencedRelation: "image_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cruise_listings_required_partner_id_fkey"
            columns: ["required_partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      cruises: {
        Row: {
          created_at: string
          cruise_name: string
          cruise_name_de: string | null
          cruise_name_es: string | null
          cruise_name_fr: string | null
          cruise_name_nl: string | null
          cruise_name_pt: string | null
          cruise_name_zh: string | null
          cruise_type: string
          departure_location: string
          description: string | null
          description_de: string | null
          description_es: string | null
          description_fr: string | null
          description_nl: string | null
          description_pt: string | null
          description_zh: string | null
          duration: string
          fareharbor_embed_script: string
          google_maps_embed: string | null
          google_maps_link: string | null
          id: string
          is_published: boolean
          minimum_duration_hours: number | null
          price_label: string | null
          reviews_embed: string | null
          seo_meta_description: string | null
          seo_meta_description_de: string | null
          seo_meta_description_es: string | null
          seo_meta_description_fr: string | null
          seo_meta_description_nl: string | null
          seo_meta_description_pt: string | null
          seo_meta_description_zh: string | null
          seo_title: string | null
          seo_title_de: string | null
          seo_title_es: string | null
          seo_title_fr: string | null
          seo_title_nl: string | null
          seo_title_pt: string | null
          seo_title_zh: string | null
          slug: string
          starting_price: number
          tagline: string | null
          tagline_de: string | null
          tagline_es: string | null
          tagline_fr: string | null
          tagline_nl: string | null
          tagline_pt: string | null
          tagline_zh: string | null
          total_capacity: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          cruise_name: string
          cruise_name_de?: string | null
          cruise_name_es?: string | null
          cruise_name_fr?: string | null
          cruise_name_nl?: string | null
          cruise_name_pt?: string | null
          cruise_name_zh?: string | null
          cruise_type: string
          departure_location: string
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          duration: string
          fareharbor_embed_script: string
          google_maps_embed?: string | null
          google_maps_link?: string | null
          id?: string
          is_published?: boolean
          minimum_duration_hours?: number | null
          price_label?: string | null
          reviews_embed?: string | null
          seo_meta_description?: string | null
          seo_meta_description_de?: string | null
          seo_meta_description_es?: string | null
          seo_meta_description_fr?: string | null
          seo_meta_description_nl?: string | null
          seo_meta_description_pt?: string | null
          seo_meta_description_zh?: string | null
          seo_title?: string | null
          seo_title_de?: string | null
          seo_title_es?: string | null
          seo_title_fr?: string | null
          seo_title_nl?: string | null
          seo_title_pt?: string | null
          seo_title_zh?: string | null
          slug: string
          starting_price: number
          tagline?: string | null
          tagline_de?: string | null
          tagline_es?: string | null
          tagline_fr?: string | null
          tagline_nl?: string | null
          tagline_pt?: string | null
          tagline_zh?: string | null
          total_capacity: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          cruise_name?: string
          cruise_name_de?: string | null
          cruise_name_es?: string | null
          cruise_name_fr?: string | null
          cruise_name_nl?: string | null
          cruise_name_pt?: string | null
          cruise_name_zh?: string | null
          cruise_type?: string
          departure_location?: string
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          duration?: string
          fareharbor_embed_script?: string
          google_maps_embed?: string | null
          google_maps_link?: string | null
          id?: string
          is_published?: boolean
          minimum_duration_hours?: number | null
          price_label?: string | null
          reviews_embed?: string | null
          seo_meta_description?: string | null
          seo_meta_description_de?: string | null
          seo_meta_description_es?: string | null
          seo_meta_description_fr?: string | null
          seo_meta_description_nl?: string | null
          seo_meta_description_pt?: string | null
          seo_meta_description_zh?: string | null
          seo_title?: string | null
          seo_title_de?: string | null
          seo_title_es?: string | null
          seo_title_fr?: string | null
          seo_title_nl?: string | null
          seo_title_pt?: string | null
          seo_title_zh?: string | null
          slug?: string
          starting_price?: number
          tagline?: string | null
          tagline_de?: string | null
          tagline_es?: string | null
          tagline_fr?: string | null
          tagline_nl?: string | null
          tagline_pt?: string | null
          tagline_zh?: string | null
          total_capacity?: number
          updated_at?: string
        }
        Relationships: []
      }
      event_cards: {
        Row: {
          cover_image_url: string | null
          created_at: string
          cruise_name: string | null
          date: string
          description: string | null
          duration: string
          end_time: string
          event_type_id: string
          fareharbor_booking_url: string | null
          id: string
          sold_out: boolean
          start_time: string
          starting_price_per_person: number
          tagline: string | null
          total_price: number
          updated_at: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          cruise_name?: string | null
          date: string
          description?: string | null
          duration: string
          end_time: string
          event_type_id: string
          fareharbor_booking_url?: string | null
          id?: string
          sold_out?: boolean
          start_time: string
          starting_price_per_person: number
          tagline?: string | null
          total_price: number
          updated_at?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          cruise_name?: string | null
          date?: string
          description?: string | null
          duration?: string
          end_time?: string
          event_type_id?: string
          fareharbor_booking_url?: string | null
          id?: string
          sold_out?: boolean
          start_time?: string
          starting_price_per_person?: number
          tagline?: string | null
          total_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_cards_event_type_id_fkey"
            columns: ["event_type_id"]
            isOneToOne: false
            referencedRelation: "event_types"
            referencedColumns: ["id"]
          },
        ]
      }
      event_tags: {
        Row: {
          event_card_id: string
          tag_id: string
        }
        Insert: {
          event_card_id: string
          tag_id: string
        }
        Update: {
          event_card_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_tags_event_card_id_fkey"
            columns: ["event_card_id"]
            isOneToOne: false
            referencedRelation: "event_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      event_types: {
        Row: {
          id: string
          type_name: string
        }
        Insert: {
          id?: string
          type_name?: string
        }
        Update: {
          id?: string
          type_name?: string
        }
        Relationships: []
      }
      extra_hours_bonuses: {
        Row: {
          amount_charged_cents: number
          commission_cents: number
          created_at: string
          date: string
          extra_minutes: number
          id: string
          note: string | null
          staff_id: string
        }
        Insert: {
          amount_charged_cents: number
          commission_cents: number
          created_at?: string
          date: string
          extra_minutes: number
          id?: string
          note?: string | null
          staff_id: string
        }
        Update: {
          amount_charged_cents?: number
          commission_cents?: number
          created_at?: string
          date?: string
          extra_minutes?: number
          id?: string
          note?: string | null
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extra_hours_bonuses_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      extras: {
        Row: {
          adults_only: boolean
          alt_text: string | null
          alt_text_de: string | null
          alt_text_es: string | null
          alt_text_fr: string | null
          alt_text_nl: string | null
          alt_text_pt: string | null
          alt_text_zh: string | null
          applicable_categories: string[] | null
          category: string
          created_at: string | null
          default_to_guest_count: boolean
          description: string | null
          description_de: string | null
          description_es: string | null
          description_fr: string | null
          description_nl: string | null
          description_pt: string | null
          description_zh: string | null
          id: string
          image_asset_id: string | null
          image_url: string | null
          ingredients: string[] | null
          is_active: boolean
          is_required: boolean
          min_people: number | null
          min_quantity: number
          name: string
          name_de: string | null
          name_es: string | null
          name_fr: string | null
          name_nl: string | null
          name_pt: string | null
          name_zh: string | null
          price_type: string
          price_value: number
          cost_price_value: number | null
          quantity_mode: string
          scope: string
          sort_order: number
          updated_at: string | null
          vat_rate: number
        }
        Insert: {
          adults_only?: boolean
          alt_text?: string | null
          alt_text_de?: string | null
          alt_text_es?: string | null
          alt_text_fr?: string | null
          alt_text_nl?: string | null
          alt_text_pt?: string | null
          alt_text_zh?: string | null
          applicable_categories?: string[] | null
          category: string
          created_at?: string | null
          default_to_guest_count?: boolean
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          id?: string
          image_asset_id?: string | null
          image_url?: string | null
          ingredients?: string[] | null
          is_active?: boolean
          is_required?: boolean
          min_people?: number | null
          min_quantity?: number
          name: string
          name_de?: string | null
          name_es?: string | null
          name_fr?: string | null
          name_nl?: string | null
          name_pt?: string | null
          name_zh?: string | null
          price_type: string
          price_value?: number
          cost_price_value?: number | null
          quantity_mode?: string
          scope: string
          sort_order?: number
          updated_at?: string | null
          vat_rate?: number
        }
        Update: {
          adults_only?: boolean
          alt_text?: string | null
          alt_text_de?: string | null
          alt_text_es?: string | null
          alt_text_fr?: string | null
          alt_text_nl?: string | null
          alt_text_pt?: string | null
          alt_text_zh?: string | null
          applicable_categories?: string[] | null
          category?: string
          created_at?: string | null
          default_to_guest_count?: boolean
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          id?: string
          image_asset_id?: string | null
          image_url?: string | null
          ingredients?: string[] | null
          is_active?: boolean
          is_required?: boolean
          min_people?: number | null
          min_quantity?: number
          name?: string
          name_de?: string | null
          name_es?: string | null
          name_fr?: string | null
          name_nl?: string | null
          name_pt?: string | null
          name_zh?: string | null
          price_type?: string
          price_value?: number
          cost_price_value?: number | null
          quantity_mode?: string
          scope?: string
          sort_order?: number
          updated_at?: string | null
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "extras_image_asset_id_fkey"
            columns: ["image_asset_id"]
            isOneToOne: false
            referencedRelation: "image_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      fareharbor_items: {
        Row: {
          booking_cutoff_hours: number | null
          cancellation_tiers: Json | null
          created_at: string | null
          customer_types: Json | null
          fareharbor_pk: number
          id: string
          is_active: boolean | null
          item_type: string
          last_synced_at: string | null
          max_slot_capacity: number | null
          name: string
          resources: Json | null
          shortname: string
        }
        Insert: {
          booking_cutoff_hours?: number | null
          cancellation_tiers?: Json | null
          created_at?: string | null
          customer_types?: Json | null
          fareharbor_pk: number
          id?: string
          is_active?: boolean | null
          item_type: string
          last_synced_at?: string | null
          max_slot_capacity?: number | null
          name: string
          resources?: Json | null
          shortname?: string
        }
        Update: {
          booking_cutoff_hours?: number | null
          cancellation_tiers?: Json | null
          created_at?: string | null
          customer_types?: Json | null
          fareharbor_pk?: number
          id?: string
          is_active?: boolean | null
          item_type?: string
          last_synced_at?: string | null
          max_slot_capacity?: number | null
          name?: string
          resources?: Json | null
          shortname?: string
        }
        Relationships: []
      }
      fareharbor_payouts: {
        Row: {
          bank_note: string | null
          bank_payout_date: string | null
          created_at: string
          gross_cents: number
          id: string
          line_count: number
          net_cents: number
          payout_date: string | null
          payout_id: string
          processing_fee_cents: number
          subtotal_paid_cents: number
          tax_paid_cents: number
          updated_at: string
          vat21_cents: number
          vat9_cents: number
        }
        Insert: {
          bank_note?: string | null
          bank_payout_date?: string | null
          created_at?: string
          gross_cents: number
          id?: string
          line_count?: number
          net_cents: number
          payout_date?: string | null
          payout_id: string
          processing_fee_cents: number
          subtotal_paid_cents: number
          tax_paid_cents?: number
          updated_at?: string
          vat21_cents?: number
          vat9_cents?: number
        }
        Update: {
          bank_note?: string | null
          bank_payout_date?: string | null
          created_at?: string
          gross_cents?: number
          id?: string
          line_count?: number
          net_cents?: number
          payout_date?: string | null
          payout_id?: string
          processing_fee_cents?: number
          subtotal_paid_cents?: number
          tax_paid_cents?: number
          updated_at?: string
          vat21_cents?: number
          vat9_cents?: number
        }
        Relationships: []
      }
      finance_budget_settings: {
        Row: {
          id: string
          maintenance_pct: number
          marketing_pct: number
          profit_first_profit_pct: number
          owner_salary_monthly_cents: number
          owner_salary_pct: number
          boat_count: number
          berth_fee_per_boat_yearly_cents: number
          other_fixed_costs_monthly_cents: number
          zettle_cogs_pct: number
          fixed_costs_monthly_cents: number
          winter_buffer_target_cents: number
          default_monthly_revenue_target_cents: number
          target_skipper_ratio_pct: number
          target_catering_margin_pct: number
          default_skipper_hourly_rate_cents: number
          revolut_manual_balance_cents: number | null
          updated_at: string
        }
        Insert: {
          id?: string
          maintenance_pct?: number
          marketing_pct?: number
          profit_first_profit_pct?: number
          owner_salary_monthly_cents?: number
          owner_salary_pct?: number
          boat_count?: number
          berth_fee_per_boat_yearly_cents?: number
          other_fixed_costs_monthly_cents?: number
          zettle_cogs_pct?: number
          fixed_costs_monthly_cents?: number
          winter_buffer_target_cents?: number
          default_monthly_revenue_target_cents?: number
          target_skipper_ratio_pct?: number
          target_catering_margin_pct?: number
          default_skipper_hourly_rate_cents?: number
          revolut_manual_balance_cents?: number | null
          updated_at?: string
        }
        Update: {
          id?: string
          maintenance_pct?: number
          marketing_pct?: number
          profit_first_profit_pct?: number
          owner_salary_monthly_cents?: number
          owner_salary_pct?: number
          boat_count?: number
          berth_fee_per_boat_yearly_cents?: number
          other_fixed_costs_monthly_cents?: number
          zettle_cogs_pct?: number
          fixed_costs_monthly_cents?: number
          winter_buffer_target_cents?: number
          default_monthly_revenue_target_cents?: number
          target_skipper_ratio_pct?: number
          target_catering_margin_pct?: number
          default_skipper_hourly_rate_cents?: number
          revolut_manual_balance_cents?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      finance_share_links: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          revoked_at: string | null
          token: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          revoked_at?: string | null
          token: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          revoked_at?: string | null
          token?: string
        }
        Relationships: []
      }
      getmyboat_bookings: {
        Row: {
          booking_id: string
          charter_date: string | null
          created_at: string
          guest_name: string | null
          id: string
          net_amount_cents: number
          payout_date: string | null
          revenue_vat_rate: number
          updated_at: string
        }
        Insert: {
          booking_id: string
          charter_date?: string | null
          created_at?: string
          guest_name?: string | null
          id?: string
          net_amount_cents: number
          payout_date?: string | null
          revenue_vat_rate?: number
          updated_at?: string
        }
        Update: {
          booking_id?: string
          charter_date?: string | null
          created_at?: string
          guest_name?: string | null
          id?: string
          net_amount_cents?: number
          payout_date?: string | null
          revenue_vat_rate?: number
          updated_at?: string
        }
        Relationships: []
      }
      getyourguide_payments: {
        Row: {
          account_number: string | null
          amount_cents: number | null
          created_at: string
          id: string
          invoice_number: string | null
          payment_number: string
          payment_run_date: string | null
          raw_filename: string | null
          storage_path: string | null
        }
        Insert: {
          account_number?: string | null
          amount_cents?: number | null
          created_at?: string
          id?: string
          invoice_number?: string | null
          payment_number: string
          payment_run_date?: string | null
          raw_filename?: string | null
          storage_path?: string | null
        }
        Update: {
          account_number?: string | null
          amount_cents?: number | null
          created_at?: string
          id?: string
          invoice_number?: string | null
          payment_number?: string
          payment_run_date?: string | null
          raw_filename?: string | null
          storage_path?: string | null
        }
        Relationships: []
      }
      ghost_knowledge: {
        Row: {
          answer: string
          created_at: string
          created_by: string | null
          id: string
          pinned: boolean
          proposal_id: string | null
          question: string
          source: string
        }
        Insert: {
          answer: string
          created_at?: string
          created_by?: string | null
          id?: string
          pinned?: boolean
          proposal_id?: string | null
          question: string
          source?: string
        }
        Update: {
          answer?: string
          created_at?: string
          created_by?: string | null
          id?: string
          pinned?: boolean
          proposal_id?: string | null
          question?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "ghost_knowledge_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "agent_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      google_ads_campaign_listings: {
        Row: {
          campaign_id: string
          created_at: string
          listing_id: string | null
          listing_slug: string | null
          marketing_campaign_id: string | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          listing_id?: string | null
          listing_slug?: string | null
          marketing_campaign_id?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          listing_id?: string | null
          listing_slug?: string | null
          marketing_campaign_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_ads_campaign_listings_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "cruise_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_ads_campaign_listings_marketing_campaign_id_fkey"
            columns: ["marketing_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      google_ads_conversions: {
        Row: {
          adjusted_at: string | null
          adjustment_response: Json | null
          adjustment_status: string | null
          consent_marketing: boolean | null
          created_at: string
          currency: string
          error: string | null
          gclid: string | null
          google_response: Json | null
          payment_intent_id: string
          status: string
          uploaded_at: string | null
          value_cents: number
        }
        Insert: {
          adjusted_at?: string | null
          adjustment_response?: Json | null
          adjustment_status?: string | null
          consent_marketing?: boolean | null
          created_at?: string
          currency?: string
          error?: string | null
          gclid?: string | null
          google_response?: Json | null
          payment_intent_id: string
          status?: string
          uploaded_at?: string | null
          value_cents?: number
        }
        Update: {
          adjusted_at?: string | null
          adjustment_response?: Json | null
          adjustment_status?: string | null
          consent_marketing?: boolean | null
          created_at?: string
          currency?: string
          error?: string | null
          gclid?: string | null
          google_response?: Json | null
          payment_intent_id?: string
          status?: string
          uploaded_at?: string | null
          value_cents?: number
        }
        Relationships: []
      }
      google_reviews_config: {
        Row: {
          created_at: string
          id: string
          last_synced_at: string | null
          outscraper_processed_ids: string[] | null
          overall_rating: number | null
          place_id: string
          place_name: string | null
          recommendations_map_url: string | null
          review_sms_auto_send: boolean
          review_sms_enabled: boolean
          review_sms_template: string | null
          total_reviews: number | null
          tripadvisor_rating: number | null
          tripadvisor_review_url_private: string | null
          tripadvisor_review_url_shared: string | null
          tripadvisor_total_reviews: number | null
          tripadvisor_url: string | null
          updated_at: string
          withlocals_experience_short_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          outscraper_processed_ids?: string[] | null
          overall_rating?: number | null
          place_id: string
          place_name?: string | null
          recommendations_map_url?: string | null
          review_sms_auto_send?: boolean
          review_sms_enabled?: boolean
          review_sms_template?: string | null
          total_reviews?: number | null
          tripadvisor_rating?: number | null
          tripadvisor_review_url_private?: string | null
          tripadvisor_review_url_shared?: string | null
          tripadvisor_total_reviews?: number | null
          tripadvisor_url?: string | null
          updated_at?: string
          withlocals_experience_short_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          last_synced_at?: string | null
          outscraper_processed_ids?: string[] | null
          overall_rating?: number | null
          place_id?: string
          place_name?: string | null
          recommendations_map_url?: string | null
          review_sms_auto_send?: boolean
          review_sms_enabled?: boolean
          review_sms_template?: string | null
          total_reviews?: number | null
          tripadvisor_rating?: number | null
          tripadvisor_review_url_private?: string | null
          tripadvisor_review_url_shared?: string | null
          tripadvisor_total_reviews?: number | null
          tripadvisor_url?: string | null
          updated_at?: string
          withlocals_experience_short_id?: string | null
        }
        Relationships: []
      }
      hero_carousel_items: {
        Row: {
          alt_text: string | null
          alt_text_de: string | null
          alt_text_es: string | null
          alt_text_fr: string | null
          alt_text_nl: string | null
          alt_text_pt: string | null
          alt_text_zh: string | null
          caption: string | null
          caption_de: string | null
          caption_es: string | null
          caption_fr: string | null
          caption_nl: string | null
          caption_pt: string | null
          caption_zh: string | null
          created_at: string
          id: string
          image_asset_id: string | null
          image_url: string
          is_active: boolean
          media_type: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          alt_text?: string | null
          alt_text_de?: string | null
          alt_text_es?: string | null
          alt_text_fr?: string | null
          alt_text_nl?: string | null
          alt_text_pt?: string | null
          alt_text_zh?: string | null
          caption?: string | null
          caption_de?: string | null
          caption_es?: string | null
          caption_fr?: string | null
          caption_nl?: string | null
          caption_pt?: string | null
          caption_zh?: string | null
          created_at?: string
          id?: string
          image_asset_id?: string | null
          image_url: string
          is_active?: boolean
          media_type?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          alt_text?: string | null
          alt_text_de?: string | null
          alt_text_es?: string | null
          alt_text_fr?: string | null
          alt_text_nl?: string | null
          alt_text_pt?: string | null
          alt_text_zh?: string | null
          caption?: string | null
          caption_de?: string | null
          caption_es?: string | null
          caption_fr?: string | null
          caption_nl?: string | null
          caption_pt?: string | null
          caption_zh?: string | null
          created_at?: string
          id?: string
          image_asset_id?: string | null
          image_url?: string
          is_active?: boolean
          media_type?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hero_carousel_items_image_asset_id_fkey"
            columns: ["image_asset_id"]
            isOneToOne: false
            referencedRelation: "image_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      homepage_section_styles: {
        Row: {
          background: Json | null
          decoration_image_url: string | null
          decoration_image_url_2: string | null
          section_key: string
          text_colors: Json
          updated_at: string
        }
        Insert: {
          background?: Json | null
          decoration_image_url?: string | null
          decoration_image_url_2?: string | null
          section_key: string
          text_colors?: Json
          updated_at?: string
        }
        Update: {
          background?: Json | null
          decoration_image_url?: string | null
          decoration_image_url_2?: string | null
          section_key?: string
          text_colors?: Json
          updated_at?: string
        }
        Relationships: []
      }
      homepage_tour_cards: {
        Row: {
          created_at: string
          cruise_id: string
          description: string | null
          description_de: string | null
          description_es: string | null
          description_fr: string | null
          description_nl: string | null
          description_pt: string | null
          description_zh: string | null
          display_order: number
          id: string
          is_active: boolean
          polaroid_image_url: string | null
          title: string | null
          title_de: string | null
          title_es: string | null
          title_fr: string | null
          title_nl: string | null
          title_pt: string | null
          title_zh: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          cruise_id: string
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          polaroid_image_url?: string | null
          title?: string | null
          title_de?: string | null
          title_es?: string | null
          title_fr?: string | null
          title_nl?: string | null
          title_pt?: string | null
          title_zh?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          cruise_id?: string
          description?: string | null
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          display_order?: number
          id?: string
          is_active?: boolean
          polaroid_image_url?: string | null
          title?: string | null
          title_de?: string | null
          title_es?: string | null
          title_fr?: string | null
          title_nl?: string | null
          title_pt?: string | null
          title_zh?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_homepage_tour_cards_cruise_id"
            columns: ["cruise_id"]
            isOneToOne: false
            referencedRelation: "cruises"
            referencedColumns: ["id"]
          },
        ]
      }
      image_assets: {
        Row: {
          alt_text: Json | null
          base_filename: string | null
          blur_data_url: string | null
          bucket: string | null
          caption: Json | null
          confidence: number | null
          context: string
          context_id: string | null
          created_at: string
          dominant_color: string | null
          failure_reason: string | null
          file_size_bytes: number | null
          id: string
          is_animated: boolean | null
          mime_type: string | null
          original_height: number | null
          original_path: string | null
          original_url: string
          original_width: number | null
          primary_keywords: string[] | null
          processed_at: string | null
          processing_step: string | null
          quality_issues: string[] | null
          sha256: string
          status: string
          updated_at: string
          variants: Json | null
        }
        Insert: {
          alt_text?: Json | null
          base_filename?: string | null
          blur_data_url?: string | null
          bucket?: string | null
          caption?: Json | null
          confidence?: number | null
          context: string
          context_id?: string | null
          created_at?: string
          dominant_color?: string | null
          failure_reason?: string | null
          file_size_bytes?: number | null
          id?: string
          is_animated?: boolean | null
          mime_type?: string | null
          original_height?: number | null
          original_path?: string | null
          original_url: string
          original_width?: number | null
          primary_keywords?: string[] | null
          processed_at?: string | null
          processing_step?: string | null
          quality_issues?: string[] | null
          sha256: string
          status?: string
          updated_at?: string
          variants?: Json | null
        }
        Update: {
          alt_text?: Json | null
          base_filename?: string | null
          blur_data_url?: string | null
          bucket?: string | null
          caption?: Json | null
          confidence?: number | null
          context?: string
          context_id?: string | null
          created_at?: string
          dominant_color?: string | null
          failure_reason?: string | null
          file_size_bytes?: number | null
          id?: string
          is_animated?: boolean | null
          mime_type?: string | null
          original_height?: number | null
          original_path?: string | null
          original_url?: string
          original_width?: number | null
          primary_keywords?: string[] | null
          processed_at?: string | null
          processing_step?: string | null
          quality_issues?: string[] | null
          sha256?: string
          status?: string
          updated_at?: string
          variants?: Json | null
        }
        Relationships: []
      }
      image_seo_history: {
        Row: {
          applied_at: string
          field_name: string
          id: string
          new_value: string | null
          previous_value: string | null
          reverted_at: string | null
          row_id: string
          session_id: string | null
          source: string
          table_name: string
        }
        Insert: {
          applied_at?: string
          field_name: string
          id?: string
          new_value?: string | null
          previous_value?: string | null
          reverted_at?: string | null
          row_id: string
          session_id?: string | null
          source?: string
          table_name: string
        }
        Update: {
          applied_at?: string
          field_name?: string
          id?: string
          new_value?: string | null
          previous_value?: string | null
          reverted_at?: string | null
          row_id?: string
          session_id?: string | null
          source?: string
          table_name?: string
        }
        Relationships: []
      }
      inclusion_templates: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          template_data: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          template_data: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          template_data?: Json
          updated_at?: string
        }
        Relationships: []
      }
      kg_entities: {
        Row: {
          created_at: string
          description: string | null
          entity_type: string
          facts: Json
          id: string
          is_published: boolean
          name: string
          schema_type: string | null
          slug: string
          sources: Json
          summary: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          entity_type: string
          facts?: Json
          id?: string
          is_published?: boolean
          name: string
          schema_type?: string | null
          slug: string
          sources?: Json
          summary?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          entity_type?: string
          facts?: Json
          id?: string
          is_published?: boolean
          name?: string
          schema_type?: string | null
          slug?: string
          sources?: Json
          summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      kg_relationships: {
        Row: {
          created_at: string
          facts: Json
          from_entity_id: string
          id: string
          relation_type: string
          to_entity_id: string
        }
        Insert: {
          created_at?: string
          facts?: Json
          from_entity_id: string
          id?: string
          relation_type: string
          to_entity_id: string
        }
        Update: {
          created_at?: string
          facts?: Json
          from_entity_id?: string
          id?: string
          relation_type?: string
          to_entity_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "kg_relationships_from_entity_id_fkey"
            columns: ["from_entity_id"]
            isOneToOne: false
            referencedRelation: "kg_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kg_relationships_to_entity_id_fkey"
            columns: ["to_entity_id"]
            isOneToOne: false
            referencedRelation: "kg_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      listing_extras: {
        Row: {
          created_at: string | null
          extra_id: string
          id: string
          is_enabled: boolean
          listing_id: string
        }
        Insert: {
          created_at?: string | null
          extra_id: string
          id?: string
          is_enabled?: boolean
          listing_id: string
        }
        Update: {
          created_at?: string | null
          extra_id?: string
          id?: string
          is_enabled?: boolean
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_extras_extra_id_fkey"
            columns: ["extra_id"]
            isOneToOne: false
            referencedRelation: "extras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "listing_extras_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "cruise_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_tasks: {
        Row: {
          boat_id: string | null
          created_at: string
          description: string | null
          id: string
          photo_descriptions: string[]
          photo_urls: string[]
          priority: string
          proposal_id: string | null
          reporter: string | null
          source: string
          source_channel: string | null
          source_slack_event_id: string | null
          status: string
          technician_emailed_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          boat_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          photo_descriptions?: string[]
          photo_urls?: string[]
          priority?: string
          proposal_id?: string | null
          reporter?: string | null
          source?: string
          source_channel?: string | null
          source_slack_event_id?: string | null
          status?: string
          technician_emailed_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          boat_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          photo_descriptions?: string[]
          photo_urls?: string[]
          priority?: string
          proposal_id?: string | null
          reporter?: string | null
          source?: string
          source_channel?: string | null
          source_slack_event_id?: string | null
          status?: string
          technician_emailed_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_tasks_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_tasks_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "agent_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      merch_products: {
        Row: {
          created_at: string
          description: string
          description_de: string | null
          description_es: string | null
          description_fr: string | null
          description_nl: string | null
          description_pt: string | null
          description_zh: string | null
          display_order: number | null
          id: string
          images: Json | null
          is_active: boolean | null
          name: string
          name_de: string | null
          name_es: string | null
          name_fr: string | null
          name_nl: string | null
          name_pt: string | null
          name_zh: string | null
          price: number
          stock_l: number | null
          stock_m: number | null
          stock_s: number | null
          stock_xl: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          display_order?: number | null
          id?: string
          images?: Json | null
          is_active?: boolean | null
          name: string
          name_de?: string | null
          name_es?: string | null
          name_fr?: string | null
          name_nl?: string | null
          name_pt?: string | null
          name_zh?: string | null
          price: number
          stock_l?: number | null
          stock_m?: number | null
          stock_s?: number | null
          stock_xl?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          description_de?: string | null
          description_es?: string | null
          description_fr?: string | null
          description_nl?: string | null
          description_pt?: string | null
          description_zh?: string | null
          display_order?: number | null
          id?: string
          images?: Json | null
          is_active?: boolean | null
          name?: string
          name_de?: string | null
          name_es?: string | null
          name_fr?: string | null
          name_nl?: string | null
          name_pt?: string | null
          name_zh?: string | null
          price?: number
          stock_l?: number | null
          stock_m?: number | null
          stock_s?: number | null
          stock_xl?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          author_name: string | null
          body: string
          body_html: string | null
          conversation_id: string
          created_at: string
          direction: string
          error: string | null
          id: string
          provider: string
          provider_message_id: string | null
          recording_url: string | null
          status: string
        }
        Insert: {
          author_name?: string | null
          body: string
          body_html?: string | null
          conversation_id: string
          created_at?: string
          direction: string
          error?: string | null
          id?: string
          provider?: string
          provider_message_id?: string | null
          recording_url?: string | null
          status?: string
        }
        Update: {
          author_name?: string | null
          body?: string
          body_html?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          error?: string | null
          id?: string
          provider?: string
          provider_message_id?: string | null
          recording_url?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_settings: {
        Row: {
          channel_id: string | null
          created_at: string
          email_recipients: string[]
          id: string
          notify_monthly: boolean
          notify_per_booking: boolean
          notify_quarterly: boolean
          notify_weekly: boolean
          partner_id: string | null
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          email_recipients?: string[]
          id?: string
          notify_monthly?: boolean
          notify_per_booking?: boolean
          notify_quarterly?: boolean
          notify_weekly?: boolean
          partner_id?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          email_recipients?: string[]
          id?: string
          notify_monthly?: boolean
          notify_per_booking?: boolean
          notify_quarterly?: boolean
          notify_weekly?: boolean
          partner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_settings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_settings_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          booking_id: string | null
          created_at: string
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          proposal_id: string | null
          shift_id: string | null
          source: string
          staff_id: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          booking_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          occurred_at?: string
          payload?: Json
          proposal_id?: string | null
          shift_id?: string | null
          source: string
          staff_id?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          booking_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          proposal_id?: string | null
          shift_id?: string | null
          source?: string
          staff_id?: string | null
        }
        Relationships: []
      }
      partner_codes: {
        Row: {
          code: string
          created_at: string
          expires_at: string
          id: string
          is_active: boolean
          issued_at: string
          notes: string | null
          partner_id: string
          revoked_at: string | null
        }
        Insert: {
          code: string
          created_at?: string
          expires_at: string
          id?: string
          is_active?: boolean
          issued_at?: string
          notes?: string | null
          partner_id: string
          revoked_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          expires_at?: string
          id?: string
          is_active?: boolean
          issued_at?: string
          notes?: string | null
          partner_id?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_codes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_settlements: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          notes: string | null
          paid_at: string
          partner_id: string
          quarter: string
          settlement_type: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          partner_id: string
          quarter: string
          settlement_type: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          partner_id?: string
          quarter?: string
          settlement_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_settlements_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          channel_id: string | null
          commission_rate: number
          contact_name: string | null
          created_at: string | null
          email: string | null
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          report_token: string
          website: string | null
        }
        Insert: {
          channel_id?: string | null
          commission_rate?: number
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          report_token?: string
          website?: string | null
        }
        Update: {
          channel_id?: string | null
          commission_rate?: number
          contact_name?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          report_token?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partners_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          bio: string | null
          created_at: string | null
          display_order: number | null
          faqs: Json | null
          id: string
          image_url: string | null
          is_active: boolean | null
          name: string
          role: string | null
          type: string
        }
        Insert: {
          bio?: string | null
          created_at?: string | null
          display_order?: number | null
          faqs?: Json | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name: string
          role?: string | null
          type: string
        }
        Update: {
          bio?: string | null
          created_at?: string | null
          display_order?: number | null
          faqs?: Json | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          name?: string
          role?: string | null
          type?: string
        }
        Relationships: []
      }
      pricing_quotes: {
        Row: {
          avail_pk: number
          base_price_cents: number
          breakdown: Json
          category: string
          city_tax_cents: number
          consumed_at: string | null
          consumed_intent_id: string | null
          created_at: string
          customer_type_rate_pk: number | null
          discount_amount_cents: number
          duration_minutes: number
          expires_at: string
          extra_quantities: Json
          extras_amount_cents: number
          guest_count: number
          id: string
          listing_id: string | null
          promo_code_id: string | null
          selected_extra_ids: string[]
          server_base_amount_cents: number
          total_cents: number
        }
        Insert: {
          avail_pk: number
          base_price_cents: number
          breakdown: Json
          category: string
          city_tax_cents: number
          consumed_at?: string | null
          consumed_intent_id?: string | null
          created_at?: string
          customer_type_rate_pk?: number | null
          discount_amount_cents?: number
          duration_minutes: number
          expires_at?: string
          extra_quantities?: Json
          extras_amount_cents: number
          guest_count: number
          id?: string
          listing_id?: string | null
          promo_code_id?: string | null
          selected_extra_ids?: string[]
          server_base_amount_cents: number
          total_cents: number
        }
        Update: {
          avail_pk?: number
          base_price_cents?: number
          breakdown?: Json
          category?: string
          city_tax_cents?: number
          consumed_at?: string | null
          consumed_intent_id?: string | null
          created_at?: string
          customer_type_rate_pk?: number | null
          discount_amount_cents?: number
          duration_minutes?: number
          expires_at?: string
          extra_quantities?: Json
          extras_amount_cents?: number
          guest_count?: number
          id?: string
          listing_id?: string | null
          promo_code_id?: string | null
          selected_extra_ids?: string[]
          server_base_amount_cents?: number
          total_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "pricing_quotes_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "cruise_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pricing_quotes_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      priorities_cards: {
        Row: {
          alt_text: string | null
          alt_text_de: string | null
          alt_text_es: string | null
          alt_text_fr: string | null
          alt_text_nl: string | null
          alt_text_pt: string | null
          alt_text_zh: string | null
          body: string
          created_at: string | null
          id: string
          image_url: string
          polaroid_color: string | null
          rotate: string
          sort_order: number
          title: string
          title_color: string | null
          updated_at: string | null
        }
        Insert: {
          alt_text?: string | null
          alt_text_de?: string | null
          alt_text_es?: string | null
          alt_text_fr?: string | null
          alt_text_nl?: string | null
          alt_text_pt?: string | null
          alt_text_zh?: string | null
          body?: string
          created_at?: string | null
          id?: string
          image_url?: string
          polaroid_color?: string | null
          rotate?: string
          sort_order?: number
          title?: string
          title_color?: string | null
          updated_at?: string | null
        }
        Update: {
          alt_text?: string | null
          alt_text_de?: string | null
          alt_text_es?: string | null
          alt_text_fr?: string | null
          alt_text_nl?: string | null
          alt_text_pt?: string | null
          alt_text_zh?: string | null
          body?: string
          created_at?: string | null
          id?: string
          image_url?: string
          polaroid_color?: string | null
          rotate?: string
          sort_order?: number
          title?: string
          title_color?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          campaign_id: string | null
          code: string
          created_at: string
          discount_scope: string
          discount_type: string
          discount_value: number | null
          fixed_discount_cents: number | null
          id: string
          is_active: boolean
          label: string
          max_uses: number | null
          notes: string | null
          partner_id: string | null
          uses_count: number
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          campaign_id?: string | null
          code: string
          created_at?: string
          discount_scope?: string
          discount_type: string
          discount_value?: number | null
          fixed_discount_cents?: number | null
          id?: string
          is_active?: boolean
          label: string
          max_uses?: number | null
          notes?: string | null
          partner_id?: string | null
          uses_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          campaign_id?: string | null
          code?: string
          created_at?: string
          discount_scope?: string
          discount_type?: string
          discount_value?: number | null
          fixed_discount_cents?: number | null
          id?: string
          is_active?: boolean
          label?: string
          max_uses?: number | null
          notes?: string | null
          partner_id?: string | null
          uses_count?: number
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promo_codes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promo_codes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      reschedule_opt_outs: {
        Row: {
          booking_id: string | null
          created_at: string
          email: string | null
          id: string
          phone: string | null
          proposal_id: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          phone?: string | null
          proposal_id?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          phone?: string | null
          proposal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reschedule_opt_outs_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reschedule_opt_outs_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "agent_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      review_bonus_conflicts: {
        Row: {
          awarded_staff_id: string | null
          candidate_staff_ids: string[]
          created_at: string
          id: string
          matched_name: string
          resolved_at: string | null
          review_id: string
        }
        Insert: {
          awarded_staff_id?: string | null
          candidate_staff_ids: string[]
          created_at?: string
          id?: string
          matched_name: string
          resolved_at?: string | null
          review_id: string
        }
        Update: {
          awarded_staff_id?: string | null
          candidate_staff_ids?: string[]
          created_at?: string
          id?: string
          matched_name?: string
          resolved_at?: string | null
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_bonus_conflicts_awarded_staff_id_fkey"
            columns: ["awarded_staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_bonus_conflicts_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "social_proof_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      review_bonuses: {
        Row: {
          amount_cents: number
          awarded_at: string
          excluded_from_payroll: boolean
          id: string
          review_id: string
          staff_id: string
        }
        Insert: {
          amount_cents?: number
          awarded_at?: string
          excluded_from_payroll?: boolean
          id?: string
          review_id: string
          staff_id: string
        }
        Update: {
          amount_cents?: number
          awarded_at?: string
          excluded_from_payroll?: boolean
          id?: string
          review_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_bonuses_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "social_proof_reviews"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "review_bonuses_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      revolut_transactions: {
        Row: {
          created_at: string
          customer_name: string | null
          description: string | null
          id: string
          occurred_at: string | null
          original_amount_cents: number
          payout_date: string | null
          processing_fee_cents: number
          settlement_amount_cents: number
          transaction_id: string
          updated_at: string
          vat21_gross_cents: number | null
          vat9_gross_cents: number | null
        }
        Insert: {
          created_at?: string
          customer_name?: string | null
          description?: string | null
          id?: string
          occurred_at?: string | null
          original_amount_cents: number
          payout_date?: string | null
          processing_fee_cents?: number
          settlement_amount_cents: number
          transaction_id: string
          updated_at?: string
          vat21_gross_cents?: number | null
          vat9_gross_cents?: number | null
        }
        Update: {
          created_at?: string
          customer_name?: string | null
          description?: string | null
          id?: string
          occurred_at?: string | null
          original_amount_cents?: number
          payout_date?: string | null
          processing_fee_cents?: number
          settlement_amount_cents?: number
          transaction_id?: string
          updated_at?: string
          vat21_gross_cents?: number | null
          vat9_gross_cents?: number | null
        }
        Relationships: []
      }
      shift_bookings: {
        Row: {
          booking_id: string
          created_at: string
          shift_id: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          shift_id: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_bookings_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_bookings_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      shifts: {
        Row: {
          boat_id: string
          booking_id: string | null
          created_at: string
          date: string
          end_at: string
          fareharbor_availability_pk: number | null
          id: string
          notes: string | null
          notified_at: string | null
          reminder_sent_at: string | null
          staff_id: string | null
          start_at: string
          status: string
          updated_at: string
        }
        Insert: {
          boat_id: string
          booking_id?: string | null
          created_at?: string
          date: string
          end_at: string
          fareharbor_availability_pk?: number | null
          id?: string
          notes?: string | null
          notified_at?: string | null
          reminder_sent_at?: string | null
          staff_id?: string | null
          start_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          boat_id?: string
          booking_id?: string | null
          created_at?: string
          date?: string
          end_at?: string
          fareharbor_availability_pk?: number | null
          id?: string
          notes?: string | null
          notified_at?: string | null
          reminder_sent_at?: string | null
          staff_id?: string | null
          start_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shifts_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      short_url_clicks: {
        Row: {
          booking_id: string | null
          created_at: string
          destination_url: string
          id: string
          ip_hash: string | null
          slug: string
          user_agent: string | null
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          destination_url: string
          id?: string
          ip_hash?: string | null
          slug: string
          user_agent?: string | null
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          destination_url?: string
          id?: string
          ip_hash?: string | null
          slug?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      slack_message_log: {
        Row: {
          channel: string | null
          direction: string
          id: string
          message_preview: string | null
          notification_type: string | null
          recipient_type: string | null
          sent_at: string
          triggered_by: string | null
        }
        Insert: {
          channel?: string | null
          direction?: string
          id?: string
          message_preview?: string | null
          notification_type?: string | null
          recipient_type?: string | null
          sent_at?: string
          triggered_by?: string | null
        }
        Update: {
          channel?: string | null
          direction?: string
          id?: string
          message_preview?: string | null
          notification_type?: string | null
          recipient_type?: string | null
          sent_at?: string
          triggered_by?: string | null
        }
        Relationships: []
      }
      slack_notification_settings: {
        Row: {
          enabled: boolean
          id: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          id: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          id?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      social_proof_reviews: {
        Row: {
          ai_draft_reply: string | null
          author_photo_url: string | null
          bonus_checked_at: string | null
          conversation_id: string | null
          created_at: string
          external_review_id: string | null
          google_profile_url: string | null
          id: string
          is_active: boolean
          language: string | null
          original_text: string | null
          possible_duplicate_of: string | null
          publish_time: string | null
          rating: number
          replied_at: string | null
          review_image_url: string | null
          review_text: string
          review_text_de: string | null
          review_text_es: string | null
          review_text_fr: string | null
          review_text_nl: string | null
          review_text_pt: string | null
          review_text_zh: string | null
          reviewer_name: string
          sort_order: number
          source: string
          updated_at: string
        }
        Insert: {
          ai_draft_reply?: string | null
          author_photo_url?: string | null
          bonus_checked_at?: string | null
          conversation_id?: string | null
          created_at?: string
          external_review_id?: string | null
          google_profile_url?: string | null
          id?: string
          is_active?: boolean
          language?: string | null
          original_text?: string | null
          possible_duplicate_of?: string | null
          publish_time?: string | null
          rating?: number
          replied_at?: string | null
          review_image_url?: string | null
          review_text: string
          review_text_de?: string | null
          review_text_es?: string | null
          review_text_fr?: string | null
          review_text_nl?: string | null
          review_text_pt?: string | null
          review_text_zh?: string | null
          reviewer_name: string
          sort_order?: number
          source?: string
          updated_at?: string
        }
        Update: {
          ai_draft_reply?: string | null
          author_photo_url?: string | null
          bonus_checked_at?: string | null
          conversation_id?: string | null
          created_at?: string
          external_review_id?: string | null
          google_profile_url?: string | null
          id?: string
          is_active?: boolean
          language?: string | null
          original_text?: string | null
          possible_duplicate_of?: string | null
          publish_time?: string | null
          rating?: number
          replied_at?: string | null
          review_image_url?: string | null
          review_text?: string
          review_text_de?: string | null
          review_text_es?: string | null
          review_text_fr?: string | null
          review_text_nl?: string | null
          review_text_pt?: string | null
          review_text_zh?: string | null
          reviewer_name?: string
          sort_order?: number
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "social_proof_reviews_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "social_proof_reviews_possible_duplicate_of_fkey"
            columns: ["possible_duplicate_of"]
            isOneToOne: false
            referencedRelation: "social_proof_reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          calendar_token: string
          created_at: string
          email: string | null
          hourly_rate_cents: number
          id: string
          is_active: boolean
          max_shifts_per_week: number | null
          name: string
          notes: string | null
          phone: string | null
          role: string
          slack_member_id: string | null
          slack_notifications_enabled: boolean
          user_id: string | null
        }
        Insert: {
          calendar_token?: string
          created_at?: string
          email?: string | null
          hourly_rate_cents?: number
          id?: string
          is_active?: boolean
          max_shifts_per_week?: number | null
          name: string
          notes?: string | null
          phone?: string | null
          role: string
          slack_member_id?: string | null
          slack_notifications_enabled?: boolean
          user_id?: string | null
        }
        Update: {
          calendar_token?: string
          created_at?: string
          email?: string | null
          hourly_rate_cents?: number
          id?: string
          is_active?: boolean
          max_shifts_per_week?: number | null
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string
          slack_member_id?: string | null
          slack_notifications_enabled?: boolean
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_availability: {
        Row: {
          created_at: string
          date: string
          end_time: string | null
          id: string
          note: string | null
          staff_id: string
          start_time: string | null
          status: string
        }
        Insert: {
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          note?: string | null
          staff_id: string
          start_time?: string | null
          status: string
        }
        Update: {
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          note?: string | null
          staff_id?: string
          start_time?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_availability_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_config: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          key: string
          label: string
          order_index: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key: string
          label: string
          order_index: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key?: string
          label?: string
          order_index?: number
          updated_at?: string
        }
        Relationships: []
      }
      stock_items: {
        Row: {
          active: boolean
          category: string
          counted_via: string | null
          created_at: string
          current_count: number
          id: string
          last_counted_at: string | null
          last_reordered_at: string | null
          location: string | null
          name: string
          pack_size: number | null
          pack_unit: string | null
          reorder_qty: number
          reorder_threshold: number
          sort_order: number
          supplier_email: string | null
          supplier_name: string | null
          unit: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string
          counted_via?: string | null
          created_at?: string
          current_count?: number
          id?: string
          last_counted_at?: string | null
          last_reordered_at?: string | null
          location?: string | null
          name: string
          pack_size?: number | null
          pack_unit?: string | null
          reorder_qty?: number
          reorder_threshold?: number
          sort_order?: number
          supplier_email?: string | null
          supplier_name?: string | null
          unit?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string
          counted_via?: string | null
          created_at?: string
          current_count?: number
          id?: string
          last_counted_at?: string | null
          last_reordered_at?: string | null
          location?: string | null
          name?: string
          pack_size?: number | null
          pack_unit?: string | null
          reorder_qty?: number
          reorder_threshold?: number
          sort_order?: number
          supplier_email?: string | null
          supplier_name?: string | null
          unit?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_health_checks: {
        Row: {
          checked_at: string
          context: Json | null
          id: string
          latency_ms: number | null
          message: string | null
          ok: boolean
          service: string
        }
        Insert: {
          checked_at?: string
          context?: Json | null
          id?: string
          latency_ms?: number | null
          message?: string | null
          ok: boolean
          service: string
        }
        Update: {
          checked_at?: string
          context?: Json | null
          id?: string
          latency_ms?: number | null
          message?: string | null
          ok?: boolean
          service?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          id: string
          tag_name: string
        }
        Insert: {
          id?: string
          tag_name: string
        }
        Update: {
          id?: string
          tag_name?: string
        }
        Relationships: []
      }
      time_entries: {
        Row: {
          clock_in_at: string
          clock_out_at: string | null
          created_at: string
          flag: string | null
          flag_resolved_by: string | null
          hourly_rate_cents: number
          id: string
          note: string | null
          shift_id: string | null
          source: string
          staff_id: string
        }
        Insert: {
          clock_in_at?: string
          clock_out_at?: string | null
          created_at?: string
          flag?: string | null
          flag_resolved_by?: string | null
          hourly_rate_cents: number
          id?: string
          note?: string | null
          shift_id?: string | null
          source: string
          staff_id: string
        }
        Update: {
          clock_in_at?: string
          clock_out_at?: string | null
          created_at?: string
          flag?: string | null
          flag_resolved_by?: string | null
          hourly_rate_cents?: number
          id?: string
          note?: string | null
          shift_id?: string | null
          source?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_flag_resolved_by_fkey"
            columns: ["flag_resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
        ]
      }
      tracking_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          metadata: Json | null
          session_id: string
          visitor_id: string
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          metadata?: Json | null
          session_id: string
          visitor_id: string
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          metadata?: Json | null
          session_id?: string
          visitor_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracking_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "analytics_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          is_active: boolean
          partner_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          is_active?: boolean
          partner_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          is_active?: boolean
          partner_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      viator_payment_batches: {
        Row: {
          advice_date: string | null
          created_at: string
          document_number: string | null
          id: string
          raw_filename: string | null
          storage_path: string | null
          total_amount_cents: number | null
        }
        Insert: {
          advice_date?: string | null
          created_at?: string
          document_number?: string | null
          id?: string
          raw_filename?: string | null
          storage_path?: string | null
          total_amount_cents?: number | null
        }
        Update: {
          advice_date?: string | null
          created_at?: string
          document_number?: string | null
          id?: string
          raw_filename?: string | null
          storage_path?: string | null
          total_amount_cents?: number | null
        }
        Relationships: []
      }
      viator_payment_lines: {
        Row: {
          arrival_date: string | null
          batch_id: string
          converted_amount_cents: number
          created_at: string
          gross_amount: number | null
          gross_currency: string | null
          id: string
          sale_date: string | null
          tour_grade_code: string | null
          tour_grade_title: string | null
          vendor_reference: string | null
          viator_reference: string
        }
        Insert: {
          arrival_date?: string | null
          batch_id: string
          converted_amount_cents: number
          created_at?: string
          gross_amount?: number | null
          gross_currency?: string | null
          id?: string
          sale_date?: string | null
          tour_grade_code?: string | null
          tour_grade_title?: string | null
          vendor_reference?: string | null
          viator_reference: string
        }
        Update: {
          arrival_date?: string | null
          batch_id?: string
          converted_amount_cents?: number
          created_at?: string
          gross_amount?: number | null
          gross_currency?: string | null
          id?: string
          sale_date?: string | null
          tour_grade_code?: string | null
          tour_grade_title?: string | null
          vendor_reference?: string | null
          viator_reference?: string
        }
        Relationships: [
          {
            foreignKeyName: "viator_payment_lines_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "viator_payment_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_logs: {
        Row: {
          created_at: string | null
          error: string | null
          headers: Json | null
          id: string
          payload: Json
          processed: boolean | null
          processed_at: string | null
          provider_event_id: string | null
          signature_valid: boolean | null
          source: string | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          headers?: Json | null
          id?: string
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
          provider_event_id?: string | null
          signature_valid?: boolean | null
          source?: string | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          headers?: Json | null
          id?: string
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
          provider_event_id?: string | null
          signature_valid?: boolean | null
          source?: string | null
        }
        Relationships: []
      }
      webp_conversion_log: {
        Row: {
          backup_path: string
          bucket: string
          converted_at: string
          db_references: Json
          id: string
          original_path: string
          webp_path: string
        }
        Insert: {
          backup_path: string
          bucket: string
          converted_at?: string
          db_references?: Json
          id?: string
          original_path: string
          webp_path: string
        }
        Update: {
          backup_path?: string
          bucket?: string
          converted_at?: string
          db_references?: Json
          id?: string
          original_path?: string
          webp_path?: string
        }
        Relationships: []
      }
      weekly_awareness_sources: {
        Row: {
          amount: number
          created_at: string
          id: string
          source_name: string
          updated_at: string
          week_start_date: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          source_name: string
          updated_at?: string
          week_start_date: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          source_name?: string
          updated_at?: string
          week_start_date?: string
        }
        Relationships: []
      }
      weekly_entry: {
        Row: {
          acquisition_count: number
          activation_count: number
          awareness_count: number
          created_at: string
          id: string
          notes: string | null
          referral_count: number
          retention_count: number
          revenue_amount: number
          revenue_bookings: number
          revenue_mode: string
          updated_at: string
          week_start_date: string
        }
        Insert: {
          acquisition_count?: number
          activation_count?: number
          awareness_count?: number
          created_at?: string
          id?: string
          notes?: string | null
          referral_count?: number
          retention_count?: number
          revenue_amount?: number
          revenue_bookings?: number
          revenue_mode: string
          updated_at?: string
          week_start_date: string
        }
        Update: {
          acquisition_count?: number
          activation_count?: number
          awareness_count?: number
          created_at?: string
          id?: string
          notes?: string | null
          referral_count?: number
          retention_count?: number
          revenue_amount?: number
          revenue_bookings?: number
          revenue_mode?: string
          updated_at?: string
          week_start_date?: string
        }
        Relationships: []
      }
      withlocals_bookings: {
        Row: {
          booking_id: string
          created_at: string
          guest_count: number | null
          guest_name: string | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          net_payout_cents: number | null
          payout_date: string | null
          revenue_vat_rate: number
          service_fee_ex_cents: number | null
          service_fee_incl_cents: number | null
          service_fee_vat_cents: number | null
          storage_path: string | null
          tour_name: string | null
          tour_price_cents: number | null
          trip_at: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          guest_count?: number | null
          guest_name?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          net_payout_cents?: number | null
          payout_date?: string | null
          revenue_vat_rate?: number
          service_fee_ex_cents?: number | null
          service_fee_incl_cents?: number | null
          service_fee_vat_cents?: number | null
          storage_path?: string | null
          tour_name?: string | null
          tour_price_cents?: number | null
          trip_at?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          guest_count?: number | null
          guest_name?: string | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          net_payout_cents?: number | null
          payout_date?: string | null
          revenue_vat_rate?: number
          service_fee_ex_cents?: number | null
          service_fee_incl_cents?: number | null
          service_fee_vat_cents?: number | null
          storage_path?: string | null
          tour_name?: string | null
          tour_price_cents?: number | null
          trip_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      zettle_monthly_sales: {
        Row: {
          card_gross_cents: number | null
          card_net_cents: number | null
          card_surcharge_cents: number | null
          cash_counted_cents: number | null
          cash_zettle_cents: number | null
          created_at: string
          id: string
          month: string
          notes: string | null
          sale_count: number | null
          total_excl_vat_cents: number | null
          total_incl_vat_cents: number | null
          total_vat_cents: number | null
          updated_at: string
          vat0_cents: number | null
          vat21_excl_cents: number | null
          vat21_incl_cents: number | null
          vat21_vat_cents: number | null
          vat9_excl_cents: number | null
          vat9_incl_cents: number | null
          vat9_vat_cents: number | null
        }
        Insert: {
          card_gross_cents?: number | null
          card_net_cents?: number | null
          card_surcharge_cents?: number | null
          cash_counted_cents?: number | null
          cash_zettle_cents?: number | null
          created_at?: string
          id?: string
          month: string
          notes?: string | null
          sale_count?: number | null
          total_excl_vat_cents?: number | null
          total_incl_vat_cents?: number | null
          total_vat_cents?: number | null
          updated_at?: string
          vat0_cents?: number | null
          vat21_excl_cents?: number | null
          vat21_incl_cents?: number | null
          vat21_vat_cents?: number | null
          vat9_excl_cents?: number | null
          vat9_incl_cents?: number | null
          vat9_vat_cents?: number | null
        }
        Update: {
          card_gross_cents?: number | null
          card_net_cents?: number | null
          card_surcharge_cents?: number | null
          cash_counted_cents?: number | null
          cash_zettle_cents?: number | null
          created_at?: string
          id?: string
          month?: string
          notes?: string | null
          sale_count?: number | null
          total_excl_vat_cents?: number | null
          total_incl_vat_cents?: number | null
          total_vat_cents?: number | null
          updated_at?: string
          vat0_cents?: number | null
          vat21_excl_cents?: number | null
          vat21_incl_cents?: number | null
          vat21_vat_cents?: number | null
          vat9_excl_cents?: number | null
          vat9_incl_cents?: number | null
          vat9_vat_cents?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      ai_spend_summary: { Args: never; Returns: Json }
      ai_usage_total_cents: { Args: never; Returns: number }
      allocate_invoice_number: {
        Args: { p_stripe_pi_id: string }
        Returns: string
      }
      get_translatable_columns: { Args: never; Returns: Json }
      ghost_stats: { Args: never; Returns: Json }
      set_section_text_color: {
        Args: { p_role: string; p_section: string; p_value: string }
        Returns: {
          background: Json | null
          decoration_image_url: string | null
          decoration_image_url_2: string | null
          section_key: string
          text_colors: Json
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "homepage_section_styles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      user_role: "admin" | "support" | "captain" | "guest" | "partner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      user_role: ["admin", "support", "captain", "guest", "partner"],
    },
  },
} as const

