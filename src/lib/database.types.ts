// supabase/migrations 의 스키마와 일치하는 타입.
// 프로젝트를 link 한 뒤에는 아래 명령으로 재생성해서 덮어써도 된다:
//   npx supabase gen types typescript --linked > src/lib/database.types.ts

export type Database = {
  public: {
    Tables: {
      orders: {
        Row: {
          id: string;
          order_group_id: string;
          source_room: string;
          name: string;
          phone: string;
          addr1: string;
          addr2: string;
          brand_raw: string;
          brand_short: string;
          product_name: string;
          color: string;
          size: string;
          vendor: string;
          note: string;
          created_by: string;
          created_at: string;
          updated_at: string;
          exported_at: string | null;
          export_id: string | null;
        };
        Insert: {
          id?: string;
          order_group_id?: string;
          source_room?: string;
          name?: string;
          phone?: string;
          addr1?: string;
          addr2?: string;
          brand_raw?: string;
          brand_short?: string;
          product_name?: string;
          color?: string;
          size?: string;
          vendor?: string;
          note?: string;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
          exported_at?: string | null;
          export_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      brand_dictionary: {
        Row: {
          id: string;
          full_name: string;
          short_form: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          full_name: string;
          short_form: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["brand_dictionary"]["Insert"]>;
        Relationships: [];
      };
      exports: {
        Row: {
          id: string;
          export_date: string;
          seq: number;
          file_name: string;
          order_count: number;
          exported_by: string;
          exported_at: string;
        };
        Insert: {
          id?: string;
          export_date: string;
          seq: number;
          file_name: string;
          order_count?: number;
          exported_by?: string;
          exported_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["exports"]["Insert"]>;
        Relationships: [];
      };
      app_credentials: {
        Row: {
          role: "member" | "admin";
          password_hash: string;
          updated_at: string;
        };
        Insert: {
          role: "member" | "admin";
          password_hash: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_credentials"]["Insert"]>;
        Relationships: [];
      };
      login_attempts: {
        Row: {
          key: string;
          failed_count: number;
          locked_until: string | null;
          updated_at: string;
        };
        Insert: {
          key: string;
          failed_count?: number;
          locked_until?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["login_attempts"]["Insert"]>;
        Relationships: [];
      };
      app_sessions: {
        Row: {
          id: string;
          role: "member" | "admin";
          token_hash: string;
          created_at: string;
          expires_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          role: "member" | "admin";
          token_hash: string;
          created_at?: string;
          expires_at: string;
          last_seen_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["app_sessions"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_invoice_export: {
        Args: { p_file_name: string | null; p_exported_by: string };
        Returns: Database["public"]["Tables"]["exports"]["Row"];
      };
      next_invoice_export_seq: {
        Args: Record<string, never>;
        Returns: number;
      };
      register_login_failure: {
        Args: { p_key: string; p_max_attempts: number; p_lock_minutes: number };
        Returns: string | null;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

type Tables = Database["public"]["Tables"];
export type Order = Tables["orders"]["Row"];
export type OrderInsert = Tables["orders"]["Insert"];
export type OrderUpdate = Tables["orders"]["Update"];
export type BrandEntry = Tables["brand_dictionary"]["Row"];
export type BrandEntryInsert = Tables["brand_dictionary"]["Insert"];
export type InvoiceExport = Tables["exports"]["Row"];
export type AppSession = Tables["app_sessions"]["Row"];
export type AppRole = AppSession["role"];
