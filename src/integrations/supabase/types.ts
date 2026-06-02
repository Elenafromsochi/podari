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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          image_path: string | null
          status: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          image_path?: string | null
          status?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          image_path?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      auth_nonces: {
        Row: {
          approved_at: string | null
          code: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          nonce: string
          referrer_id: string | null
          rejected_at: string | null
          telegram_first_name: string | null
          telegram_id: number | null
          telegram_username: string | null
        }
        Insert: {
          approved_at?: string | null
          code?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          nonce: string
          referrer_id?: string | null
          rejected_at?: string | null
          telegram_first_name?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
        }
        Update: {
          approved_at?: string | null
          code?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          nonce?: string
          referrer_id?: string | null
          rejected_at?: string | null
          telegram_first_name?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
        }
        Relationships: []
      }
      chats: {
        Row: {
          created_at: string
          gift_id: string | null
          id: string
          user_a: string | null
          user_b: string | null
          wish_id: string | null
        }
        Insert: {
          created_at?: string
          gift_id?: string | null
          id?: string
          user_a?: string | null
          user_b?: string | null
          wish_id?: string | null
        }
        Update: {
          created_at?: string
          gift_id?: string | null
          id?: string
          user_a?: string | null
          user_b?: string | null
          wish_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chats_gift_id_fkey"
            columns: ["gift_id"]
            isOneToOne: false
            referencedRelation: "gifts"
            referencedColumns: ["id"]
          },
        ]
      }
      device_login_codes: {
        Row: {
          attempts: number
          code: string
          consumed_at: string | null
          created_at: string
          device_id: string
          expires_at: string
          id: string
          pending_access_token: string | null
          pending_refresh_token: string | null
          user_id: string
        }
        Insert: {
          attempts?: number
          code: string
          consumed_at?: string | null
          created_at?: string
          device_id: string
          expires_at?: string
          id?: string
          pending_access_token?: string | null
          pending_refresh_token?: string | null
          user_id: string
        }
        Update: {
          attempts?: number
          code?: string
          consumed_at?: string | null
          created_at?: string
          device_id?: string
          expires_at?: string
          id?: string
          pending_access_token?: string | null
          pending_refresh_token?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gifts: {
        Row: {
          category: string
          cost: number
          cost_flag: boolean
          created_at: string
          description: string | null
          gift_kind: string
          id: string
          image_url: string | null
          owner_id: string
          price_rub: number | null
          price_tier: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          cost?: number
          cost_flag?: boolean
          created_at?: string
          description?: string | null
          gift_kind?: string
          id?: string
          image_url?: string | null
          owner_id: string
          price_rub?: number | null
          price_tier?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          cost?: number
          cost_flag?: boolean
          created_at?: string
          description?: string | null
          gift_kind?: string
          id?: string
          image_url?: string | null
          owner_id?: string
          price_rub?: number | null
          price_tier?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          chat_id: string
          content: string
          created_at: string
          id: string
          sender_id: string | null
        }
        Insert: {
          chat_id: string
          content: string
          created_at?: string
          id?: string
          sender_id?: string | null
        }
        Update: {
          chat_id?: string
          content?: string
          created_at?: string
          id?: string
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          balance: number
          created_at: string
          display_name: string
          id: string
          last_seen_at: string | null
          level: number
          password_set: boolean
          referred_by: string | null
          telegram_id: number | null
          telegram_username: string | null
          updated_at: string
          user_id: string | null
          xp: number
        }
        Insert: {
          balance?: number
          created_at?: string
          display_name?: string
          id?: string
          last_seen_at?: string | null
          level?: number
          password_set?: boolean
          referred_by?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id?: string | null
          xp?: number
        }
        Update: {
          balance?: number
          created_at?: string
          display_name?: string
          id?: string
          last_seen_at?: string | null
          level?: number
          password_set?: boolean
          referred_by?: string | null
          telegram_id?: number | null
          telegram_username?: string | null
          updated_at?: string
          user_id?: string | null
          xp?: number
        }
        Relationships: []
      }
      reviews: {
        Row: {
          author_id: string | null
          comment: string | null
          created_at: string
          id: string
          is_auto: boolean
          rating: number
          target_id: string | null
          transaction_id: string | null
        }
        Insert: {
          author_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          is_auto?: boolean
          rating: number
          target_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          author_id?: string | null
          comment?: string | null
          created_at?: string
          id?: string
          is_auto?: boolean
          rating?: number
          target_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_referrals: {
        Row: {
          created_at: string
          referred_by: string
          telegram_id: number
        }
        Insert: {
          created_at?: string
          referred_by: string
          telegram_id: number
        }
        Update: {
          created_at?: string
          referred_by?: string
          telegram_id?: number
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string
          gift_id: string | null
          handover_requested_at: string | null
          id: string
          receiver_id: string | null
          sender_id: string | null
          status: string
        }
        Insert: {
          amount?: number
          created_at?: string
          gift_id?: string | null
          handover_requested_at?: string | null
          id?: string
          receiver_id?: string | null
          sender_id?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          gift_id?: string | null
          handover_requested_at?: string | null
          id?: string
          receiver_id?: string | null
          sender_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_gift_id_fkey"
            columns: ["gift_id"]
            isOneToOne: false
            referencedRelation: "gifts"
            referencedColumns: ["id"]
          },
        ]
      }
      trusted_devices: {
        Row: {
          created_at: string
          device_id: string
          expires_at: string
          label: string | null
          last_seen_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          expires_at: string
          label?: string | null
          last_seen_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          expires_at?: string
          label?: string | null
          last_seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_achievements: {
        Row: {
          awarded_at: string
          code: string
          id: string
          user_id: string
          xp_granted: number
        }
        Insert: {
          awarded_at?: string
          code: string
          id?: string
          user_id: string
          xp_granted?: number
        }
        Update: {
          awarded_at?: string
          code?: string
          id?: string
          user_id?: string
          xp_granted?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wish_transactions: {
        Row: {
          created_at: string
          giver_id: string
          handover_requested_at: string | null
          id: string
          status: string
          wish_id: string
          wisher_id: string
        }
        Insert: {
          created_at?: string
          giver_id: string
          handover_requested_at?: string | null
          id?: string
          status?: string
          wish_id: string
          wisher_id: string
        }
        Update: {
          created_at?: string
          giver_id?: string
          handover_requested_at?: string | null
          id?: string
          status?: string
          wish_id?: string
          wisher_id?: string
        }
        Relationships: []
      }
      wishes: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          owner_id: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          owner_id: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          owner_id?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      profiles_public: {
        Row: {
          created_at: string | null
          display_name: string | null
          level: number | null
          user_id: string | null
          xp: number | null
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          level?: number | null
          user_id?: string | null
          xp?: number | null
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          level?: number | null
          user_id?: string | null
          xp?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      apply_referral_bonus: { Args: { _new_user: string }; Returns: undefined }
      calc_level: { Args: { _xp: number }; Returns: number }
      cancel_by_sender: {
        Args: { _transaction_id: string }
        Returns: undefined
      }
      cancel_claim: { Args: { _transaction_id: string }; Returns: undefined }
      cancel_wish_claim: {
        Args: { _transaction_id: string }
        Returns: undefined
      }
      claim_gift: {
        Args: { _gift_id: string }
        Returns: {
          chat_id: string
          transaction_id: string
        }[]
      }
      confirm_handover: {
        Args: { _transaction_id: string }
        Returns: undefined
      }
      confirm_wish_received: {
        Args: { _transaction_id: string }
        Returns: undefined
      }
      decline_handover: {
        Args: { _transaction_id: string }
        Returns: undefined
      }
      fulfill_wish: {
        Args: { _wish_id: string }
        Returns: {
          chat_id: string
          transaction_id: string
        }[]
      }
      get_public_profiles: {
        Args: { _user_ids: string[] }
        Returns: {
          display_name: string
          level: number
          user_id: string
          xp: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      publish_wish: {
        Args: {
          _category: string
          _description: string
          _image_url: string
          _title: string
        }
        Returns: string
      }
      request_handover: {
        Args: { _transaction_id: string }
        Returns: undefined
      }
      request_wish_handover: {
        Args: { _transaction_id: string }
        Returns: undefined
      }
      sync_achievements: {
        Args: never
        Returns: {
          code: string
          xp_granted: number
        }[]
      }
      touch_last_seen: { Args: never; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
