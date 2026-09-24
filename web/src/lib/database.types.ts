// Written in the `supabase gen types typescript` format from
// supabase/migrations/001_initial.sql to 003_corpus_retention.sql.
// Regenerate with the Supabase CLI after any schema change:
//   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      corpus_versions: {
        Row: {
          id: string; active: boolean; count: number; extracted_at: string; method: string;
          created_at: string; activated_at: string | null; activation_unknown: boolean;
        };
        Insert: {
          id?: string; active?: boolean; count: number; extracted_at: string; method: string;
          created_at?: string; activated_at?: string | null; activation_unknown?: boolean;
        };
        Update: {
          id?: string; active?: boolean; count?: number; extracted_at?: string; method?: string;
          created_at?: string; activated_at?: string | null; activation_unknown?: boolean;
        };
        Relationships: [];
      };
      questions: {
        Row: { version_id: string; id: string; document: Json; content_hash: string };
        Insert: { version_id: string; id: string; document: Json; content_hash: string };
        Update: { version_id?: string; id?: string; document?: Json; content_hash?: string };
        Relationships: [{
          foreignKeyName: "questions_version_id_fkey"; columns: ["version_id"]; isOneToOne: false;
          referencedRelation: "corpus_versions"; referencedColumns: ["id"];
        }];
      };
      passages: {
        Row: {
          version_id: string; id: string; question_id: string; section: string; position: number;
          content: string; search_text: string; embedding: string | null; embedding_model: string | null; fts: unknown;
        };
        Insert: {
          version_id: string; id: string; question_id: string; section: string; position: number;
          content: string; search_text: string; embedding?: string | null; embedding_model?: string | null;
        };
        Update: {
          version_id?: string; id?: string; question_id?: string; section?: string; position?: number;
          content?: string; search_text?: string; embedding?: string | null; embedding_model?: string | null;
        };
        Relationships: [{
          foreignKeyName: "passages_version_id_question_id_fkey"; columns: ["version_id", "question_id"]; isOneToOne: false;
          referencedRelation: "questions"; referencedColumns: ["version_id", "id"];
        }];
      };
      quotas: {
        Row: { bucket: string; used: number; expires_at: string };
        Insert: { bucket: string; used?: number; expires_at: string };
        Update: { bucket?: string; used?: number; expires_at?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      activate_corpus: { Args: { p_id: string; p_passage_count: number }; Returns: undefined };
      prune_corpus_versions: { Args: { p_keep: number }; Returns: number };
      search_passages: {
        Args: { p_query: string; p_vector?: string | null; p_limit?: number };
        Returns: { id: string; question_id: string; section: string; content: string; position: number; score: number; document: Json }[];
      };
      reserve_chat_quota: {
        Args: {
          p_session: string; p_ip: string; p_paid: boolean; p_daily_limit: number;
          p_hourly_limit: number; p_ai_ip_daily_limit: number;
        };
        Returns: string;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
