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
      corpus_versions: {
        Row: {
          activated_at: string | null
          activation_unknown: boolean
          active: boolean
          count: number
          created_at: string
          extracted_at: string
          id: string
          method: string
        }
        Insert: {
          activated_at?: string | null
          activation_unknown?: boolean
          active?: boolean
          count: number
          created_at?: string
          extracted_at: string
          id?: string
          method: string
        }
        Update: {
          activated_at?: string | null
          activation_unknown?: boolean
          active?: boolean
          count?: number
          created_at?: string
          extracted_at?: string
          id?: string
          method?: string
        }
        Relationships: []
      }
      passages: {
        Row: {
          content: string
          embedding: string | null
          embedding_model: string | null
          fts: unknown
          id: string
          position: number
          question_id: string
          search_text: string
          section: string
          version_id: string
        }
        Insert: {
          content: string
          embedding?: string | null
          embedding_model?: string | null
          fts?: unknown
          id: string
          position: number
          question_id: string
          search_text: string
          section: string
          version_id: string
        }
        Update: {
          content?: string
          embedding?: string | null
          embedding_model?: string | null
          fts?: unknown
          id?: string
          position?: number
          question_id?: string
          search_text?: string
          section?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "passages_version_id_question_id_fkey"
            columns: ["version_id", "question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["version_id", "id"]
          },
        ]
      }
      questions: {
        Row: {
          content_hash: string
          document: Json
          id: string
          version_id: string
        }
        Insert: {
          content_hash: string
          document: Json
          id: string
          version_id: string
        }
        Update: {
          content_hash?: string
          document?: Json
          id?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questions_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "corpus_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      quotas: {
        Row: {
          bucket: string
          expires_at: string
          used: number
        }
        Insert: {
          bucket: string
          expires_at: string
          used?: number
        }
        Update: {
          bucket?: string
          expires_at?: string
          used?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_corpus: {
        Args: { p_id: string; p_passage_count: number }
        Returns: undefined
      }
      clone_unchanged_questions: {
        Args: { p_from: string; p_model: string; p_questions: Json; p_to: string }
        Returns: string[]
      }
      prune_corpus_versions: { Args: { p_keep: number }; Returns: number }
      reserve_chat_quota: {
        Args: {
          p_ai_ip_daily_limit: number
          p_daily_limit: number
          p_hourly_limit: number
          p_ip: string
          p_paid: boolean
          p_session: string
        }
        Returns: string
      }
      search_passages: {
        Args: { p_limit?: number; p_query: string; p_vector?: string }
        Returns: {
          content: string
          document: Json
          id: string
          position: number
          question_id: string
          score: number
          section: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
