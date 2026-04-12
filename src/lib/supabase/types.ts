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
      analytics_sessions: {
        Row: {
          browser_name: string | null
          campaign_slug: string | null
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
          campaign_slug?: string | null
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
          campaign_slug?: string | null
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
        Relationships: []
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
          booking_uuid: string | null
          campaign_id: string | null
          category: string | null
          created_at: string | null
          currency: string | null
          customer_email: string
          customer_name: string
          customer_phone: string | null
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
          payment_status: string | null
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
          booking_uuid?: string | null
          campaign_id?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          customer_email: string
          customer_name: string
          customer_phone?: string | null
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
          payment_status?: string | null
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
          booking_uuid?: string | null
          campaign_id?: string | null
          category?: string | null
          created_at?: string | null
          currency?: string | null
          customer_email?: string
          customer_name?: string
          customer_phone?: string | null
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
          payment_status?: string | null
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
          commission_percentage: number | null
          created_at: string | null
          destination_url: string
          id: string
          investment_amount: number | null
          is_active: boolean | null
          name: string
          partner_id: string
          slug: string
        }
        Insert: {
          commission_percentage?: number | null
          created_at?: string | null
          destination_url: string
          id?: string
          investment_amount?: number | null
          is_active?: boolean | null
          name: string
          partner_id: string
          slug: string
        }
        Update: {
          commission_percentage?: number | null
          created_at?: string | null
          destination_url?: string
          id?: string
          investment_amount?: number | null
          is_active?: boolean | null
          name?: string
          partner_id?: string
          slug?: string
        }
        Relationships: [
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
          created_at: string | null
          id: string
          investment_amount: number | null
          investment_type: string | null
          is_active: boolean | null
          name: string
          notes: string | null
          percentage_value: number | null
          slug: string
          updated_at: string | null
        }
        Insert: {
          category: string
          created_at?: string | null
          id?: string
          investment_amount?: number | null
          investment_type?: string | null
          is_active?: boolean | null
          name: string
          notes?: string | null
          percentage_value?: number | null
          slug: string
          updated_at?: string | null
        }
        Update: {
          category?: string
          created_at?: string | null
          id?: string
          investment_amount?: number | null
          investment_type?: string | null
          is_active?: boolean | null
          name?: string
          notes?: string | null
          percentage_value?: number | null
          slug?: string
          updated_at?: string | null
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
          hero_image_url: string | null
          highlights: Json | null
          id: string
          images: Json | null
          inclusions: Json | null
          is_featured: boolean | null
          is_published: boolean | null
          max_guests: number | null
          price_display: string | null
          price_label: string | null
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
        }
        Insert: {
          allowed_customer_type_pks?: number[] | null
          allowed_resource_pks?: number[] | null
          availability_filters?: Json | null
          benefits?: Json | null
          boat_id?: string | null
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
          hero_image_url?: string | null
          highlights?: Json | null
          id?: string
          images?: Json | null
          inclusions?: Json | null
          is_featured?: boolean | null
          is_published?: boolean | null
          max_guests?: number | null
          price_display?: string | null
          price_label?: string | null
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
        }
        Update: {
          allowed_customer_type_pks?: number[] | null
          allowed_resource_pks?: number[] | null
          availability_filters?: Json | null
          benefits?: Json | null
          boat_id?: string | null
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
          hero_image_url?: string | null
          highlights?: Json | null
          id?: string
          images?: Json | null
          inclusions?: Json | null
          is_featured?: boolean | null
          is_published?: boolean | null
          max_guests?: number | null
          price_display?: string | null
          price_label?: string | null
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
        }
        Relationships: [
          {
            foreignKeyName: "cruise_listings_boat_id_fkey"
            columns: ["boat_id"]
            isOneToOne: false
            referencedRelation: "boats"
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
          image_url: string | null
          ingredients: string[] | null
          is_active: boolean
          is_required: boolean
          name: string
          name_de: string | null
          name_es: string | null
          name_fr: string | null
          name_nl: string | null
          name_pt: string | null
          name_zh: string | null
          price_type: string
          price_value: number
          scope: string
          sort_order: number
          updated_at: string | null
          vat_rate: number
        }
        Insert: {
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
          image_url?: string | null
          ingredients?: string[] | null
          is_active?: boolean
          is_required?: boolean
          name: string
          name_de?: string | null
          name_es?: string | null
          name_fr?: string | null
          name_nl?: string | null
          name_pt?: string | null
          name_zh?: string | null
          price_type: string
          price_value?: number
          scope: string
          sort_order?: number
          updated_at?: string | null
          vat_rate?: number
        }
        Update: {
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
          image_url?: string | null
          ingredients?: string[] | null
          is_active?: boolean
          is_required?: boolean
          name?: string
          name_de?: string | null
          name_es?: string | null
          name_fr?: string | null
          name_nl?: string | null
          name_pt?: string | null
          name_zh?: string | null
          price_type?: string
          price_value?: number
          scope?: string
          sort_order?: number
          updated_at?: string | null
          vat_rate?: number
        }
        Relationships: []
      }
      fareharbor_items: {
        Row: {
          created_at: string | null
          customer_types: Json | null
          fareharbor_pk: number
          id: string
          is_active: boolean | null
          item_type: string
          last_synced_at: string | null
          name: string
          resources: Json | null
          shortname: string
        }
        Insert: {
          created_at?: string | null
          customer_types?: Json | null
          fareharbor_pk: number
          id?: string
          is_active?: boolean | null
          item_type: string
          last_synced_at?: string | null
          name: string
          resources?: Json | null
          shortname?: string
        }
        Update: {
          created_at?: string | null
          customer_types?: Json | null
          fareharbor_pk?: number
          id?: string
          is_active?: boolean | null
          item_type?: string
          last_synced_at?: string | null
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
          caption: string | null
          created_at: string
          id: string
          image_url: string
          is_active: boolean
          media_type: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          is_active?: boolean
          media_type?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          alt_text?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          is_active?: boolean
          media_type?: string
          sort_order?: number
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
      partners: {
        Row: {
          created_at: string | null
          id: string
          name: string
          report_token: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          report_token?: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          report_token?: string
        }
        Relationships: []
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
      user_profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
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

