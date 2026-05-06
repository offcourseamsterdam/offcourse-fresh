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
          commission_amount_cents: number | null
          created_at: string | null
          currency: string | null
          customer_email: string
          customer_name: string
          customer_phone: string | null
          deposit_amount_cents: number | null
          discount_amount_cents: number
          end_time: string | null
          external_id: string | null
          extras_amount_cents: number | null
          extras_selected: Json | null
          extras_vat_amount_cents: number | null
          fareharbor_availability_pk: number | null
          fareharbor_customer_type_rate_pk: number | null
          guest_count: number | null
          guest_note: string | null
          id: string
          listing_id: string | null
          listing_title: string | null
          partner_id: string | null
          payment_link_expires_at: string | null
          payment_reminder_sent: boolean | null
          payment_status: string | null
          promo_code_id: string | null
          raw_payload: Json | null
          receipt_total: number | null
          receipt_total_display: string | null
          session_id: string | null
          start_time: string | null
          status: string | null
          stripe_amount: number | null
          stripe_payment_intent_id: string | null
          stripe_session_id: string | null
          total_vat_amount_cents: number | null
          tour_item_id: string | null
          tour_item_name: string | null
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
          commission_amount_cents?: number | null
          created_at?: string | null
          currency?: string | null
          customer_email: string
          customer_name: string
          customer_phone?: string | null
          deposit_amount_cents?: number | null
          discount_amount_cents?: number
          end_time?: string | null
          external_id?: string | null
          extras_amount_cents?: number | null
          extras_selected?: Json | null
          extras_vat_amount_cents?: number | null
          fareharbor_availability_pk?: number | null
          fareharbor_customer_type_rate_pk?: number | null
          guest_count?: number | null
          guest_note?: string | null
          id?: string
          listing_id?: string | null
          listing_title?: string | null
          partner_id?: string | null
          payment_link_expires_at?: string | null
          payment_reminder_sent?: boolean | null
          payment_status?: string | null
          promo_code_id?: string | null
          raw_payload?: Json | null
          receipt_total?: number | null
          receipt_total_display?: string | null
          session_id?: string | null
          start_time?: string | null
          status?: string | null
          stripe_amount?: number | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          total_vat_amount_cents?: number | null
          tour_item_id?: string | null
          tour_item_name?: string | null
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
          commission_amount_cents?: number | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
          deposit_amount_cents?: number | null
          discount_amount_cents?: number
          end_time?: string | null
          external_id?: string | null
          extras_amount_cents?: number | null
          extras_selected?: Json | null
          extras_vat_amount_cents?: number | null
          fareharbor_availability_pk?: number | null
          fareharbor_customer_type_rate_pk?: number | null
          guest_count?: number | null
          guest_note?: string | null
          id?: string
          listing_id?: string | null
          listing_title?: string | null
          partner_id?: string | null
          payment_link_expires_at?: string | null
          payment_reminder_sent?: boolean | null
          payment_status?: string | null
          promo_code_id?: string | null
          raw_payload?: Json | null
          receipt_total?: number | null
          receipt_total_display?: string | null
          session_id?: string | null
          start_time?: string | null
          status?: string | null
          stripe_amount?: number | null
          stripe_payment_intent_id?: string | null
          stripe_session_id?: string | null
          total_vat_amount_cents?: number | null
          tour_item_id?: string | null
          tour_item_name?: string | null
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
            referencedRelation: "campaign_links"
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
      extras: {
        Row: {
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
          quantity_mode: string
          scope: string
          sort_order: number
          updated_at: string | null
          vat_rate: number
        }
        Insert: {
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
          quantity_mode?: string
          scope: string
          sort_order?: number
          updated_at?: string | null
          vat_rate?: number
        }
        Update: {
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
      google_reviews_config: {
        Row: {
          access_token: string | null
          created_at: string
          google_account_id: string | null
          google_location_id: string | null
          id: string
          last_synced_at: string | null
          overall_rating: number | null
          place_id: string
          place_name: string | null
          refresh_token: string | null
          token_expires_at: string | null
          total_reviews: number | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          google_account_id?: string | null
          google_location_id?: string | null
          id?: string
          last_synced_at?: string | null
          overall_rating?: number | null
          place_id: string
          place_name?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          total_reviews?: number | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          google_account_id?: string | null
          google_location_id?: string | null
          id?: string
          last_synced_at?: string | null
          overall_rating?: number | null
          place_id?: string
          place_name?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          total_reviews?: number | null
          updated_at?: string
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
          rotate: string
          sort_order: number
          title: string
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
          rotate?: string
          sort_order?: number
          title?: string
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
          rotate?: string
          sort_order?: number
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          code: string
          created_at: string
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
          code: string
          created_at?: string
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
          code?: string
          created_at?: string
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
            foreignKeyName: "promo_codes_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      social_proof_reviews: {
        Row: {
          ai_draft_reply: string | null
          author_photo_url: string | null
          confirmed_reply: string | null
          created_at: string
          google_profile_url: string | null
          google_review_id: string | null
          id: string
          is_active: boolean
          language: string | null
          original_text: string | null
          owner_reply_text: string | null
          owner_reply_time: string | null
          publish_time: string | null
          rating: number
          reply_posted_at: string | null
          reply_posted_by: string | null
          reply_synced_at: string | null
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
          confirmed_reply?: string | null
          created_at?: string
          google_profile_url?: string | null
          google_review_id?: string | null
          id?: string
          is_active?: boolean
          language?: string | null
          original_text?: string | null
          owner_reply_text?: string | null
          owner_reply_time?: string | null
          publish_time?: string | null
          rating?: number
          reply_posted_at?: string | null
          reply_posted_by?: string | null
          reply_synced_at?: string | null
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
          confirmed_reply?: string | null
          created_at?: string
          google_profile_url?: string | null
          google_review_id?: string | null
          id?: string
          is_active?: boolean
          language?: string | null
          original_text?: string | null
          owner_reply_text?: string | null
          owner_reply_time?: string | null
          publish_time?: string | null
          rating?: number
          reply_posted_at?: string | null
          reply_posted_by?: string | null
          reply_synced_at?: string | null
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
        Relationships: []
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
      webhook_logs: {
        Row: {
          created_at: string | null
          error: string | null
          headers: Json | null
          id: string
          payload: Json
          processed: boolean | null
          source: string | null
        }
        Insert: {
          created_at?: string | null
          error?: string | null
          headers?: Json | null
          id?: string
          payload: Json
          processed?: boolean | null
          source?: string | null
        }
        Update: {
          created_at?: string | null
          error?: string | null
          headers?: Json | null
          id?: string
          payload?: Json
          processed?: boolean | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_translatable_columns: { Args: never; Returns: Json }
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

