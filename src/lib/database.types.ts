export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      competencias: {
        Row: {
          codigo: string;
          estado: string;
          id: string;
          referencia: string;
        };
        Insert: {
          codigo: string;
          estado: string;
          id?: string;
          referencia: string;
        };
        Update: {
          codigo?: string;
          estado?: string;
          id?: string;
          referencia?: string;
        };
        Relationships: [];
      };
      entradas: {
        Row: {
          autor_id: string;
          competencia_id: string;
          escopo_id: string;
          estado: string;
          id: string;
          indicador_id: string;
          operation_id: string;
          revisao: number;
          valor: number;
        };
        Insert: {
          autor_id: string;
          competencia_id: string;
          escopo_id: string;
          estado: string;
          id?: string;
          indicador_id: string;
          operation_id: string;
          revisao: number;
          valor: number;
        };
        Update: {
          autor_id?: string;
          competencia_id?: string;
          escopo_id?: string;
          estado?: string;
          id?: string;
          indicador_id?: string;
          operation_id?: string;
          revisao?: number;
          valor?: number;
        };
        Relationships: [
          {
            foreignKeyName: "fk_entradas_competencia";
            columns: ["competencia_id"];
            isOneToOne: false;
            referencedRelation: "competencias";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_entradas_escopo";
            columns: ["escopo_id"];
            isOneToOne: false;
            referencedRelation: "escopos";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_entradas_indicador";
            columns: ["indicador_id"];
            isOneToOne: false;
            referencedRelation: "indicadores";
            referencedColumns: ["id"];
          },
        ];
      };
      escopos: {
        Row: {
          codigo: string;
          id: string;
        };
        Insert: {
          codigo: string;
          id?: string;
        };
        Update: {
          codigo?: string;
          id?: string;
        };
        Relationships: [];
      };
      eventos_auditoria: {
        Row: {
          acao: string;
          actor_id: string;
          detalhes: NonNullable<Json>;
          id: string;
          ocorrido_em: string;
          recurso_id: string;
          recurso_tipo: string;
        };
        Insert: {
          acao: string;
          actor_id: string;
          detalhes?: NonNullable<Json>;
          id?: string;
          ocorrido_em?: string;
          recurso_id: string;
          recurso_tipo: string;
        };
        Update: {
          acao?: string;
          actor_id?: string;
          detalhes?: NonNullable<Json>;
          id?: string;
          ocorrido_em?: string;
          recurso_id?: string;
          recurso_tipo?: string;
        };
        Relationships: [];
      };
      indicadores: {
        Row: {
          codigo: string;
          id: string;
        };
        Insert: {
          codigo: string;
          id?: string;
        };
        Update: {
          codigo?: string;
          id?: string;
        };
        Relationships: [];
      };
      regras: {
        Row: {
          fator: number;
          id: string;
          indicador_id: string;
          versao: number;
          vigencia_fim: string | null;
          vigencia_inicio: string;
        };
        Insert: {
          fator: number;
          id?: string;
          indicador_id: string;
          versao: number;
          vigencia_fim?: string | null;
          vigencia_inicio: string;
        };
        Update: {
          fator?: number;
          id?: string;
          indicador_id?: string;
          versao?: number;
          vigencia_fim?: string | null;
          vigencia_inicio?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_regras_indicador";
            columns: ["indicador_id"];
            isOneToOne: false;
            referencedRelation: "indicadores";
            referencedColumns: ["id"];
          },
        ];
      };
      resultados: {
        Row: {
          entrada_id: string;
          id: string;
          memoria: NonNullable<Json>;
          regra_id: string;
          valor: number;
        };
        Insert: {
          entrada_id: string;
          id?: string;
          memoria: NonNullable<Json>;
          regra_id: string;
          valor: number;
        };
        Update: {
          entrada_id?: string;
          id?: string;
          memoria?: NonNullable<Json>;
          regra_id?: string;
          valor?: number;
        };
        Relationships: [
          {
            foreignKeyName: "fk_resultados_entrada";
            columns: ["entrada_id"];
            isOneToOne: false;
            referencedRelation: "entradas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_resultados_regra";
            columns: ["regra_id"];
            isOneToOne: false;
            referencedRelation: "regras";
            referencedColumns: ["id"];
          },
        ];
      };
      vinculos: {
        Row: {
          actor_id: string;
          escopo_id: string;
          id: string;
          papel: string;
        };
        Insert: {
          actor_id: string;
          escopo_id: string;
          id?: string;
          papel: string;
        };
        Update: {
          actor_id?: string;
          escopo_id?: string;
          id?: string;
          papel?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fk_vinculos_escopo";
            columns: ["escopo_id"];
            isOneToOne: false;
            referencedRelation: "escopos";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
