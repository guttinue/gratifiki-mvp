
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "public": {
          Tables: {
            "ativacoes_regra": {
                  Row: {
                    "id": string,"indicador_id": string,"primeiro_mes": string,"referencia_demo": string,"regra_id": string
                  }
                  Insert: {
                    "id"?: string,"indicador_id": string,"primeiro_mes": string,"referencia_demo": string,"regra_id": string
                  }
                  Update: {
                    "id"?: string,"indicador_id"?: string,"primeiro_mes"?: string,"referencia_demo"?: string,"regra_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ativacoes_regra_indicador_id_fkey"
      columns: ["indicador_id"]
isOneToOne: false
      referencedRelation: "indicadores"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_ativacoes_regra_indicador"
      columns: ["regra_id","indicador_id"]
isOneToOne: false
      referencedRelation: "regras"
      referencedColumns: ["id","indicador_id"]
    }
                  ]
                },"competencias": {
                  Row: {
                    "codigo": string,"conjunto_id": string | null,"estado": string,"id": string,"lock_version": number,"modelo": number,"referencia": string
                  }
                  Insert: {
                    "codigo": string,"conjunto_id"?: string | null,"estado": string,"id"?: string,"lock_version"?: number,"modelo"?: number,"referencia": string
                  }
                  Update: {
                    "codigo"?: string,"conjunto_id"?: string | null,"estado"?: string,"id"?: string,"lock_version"?: number,"modelo"?: number,"referencia"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "competencias_conjunto_id_fkey"
      columns: ["conjunto_id"]
isOneToOne: false
      referencedRelation: "conjuntos_regra"
      referencedColumns: ["id"]
    }
                  ]
                },"conjuntos_regra": {
                  Row: {
                    "codigo": string,"id": string,"modo_ausencia": string,"referencia": string,"sintetico": boolean,"versao": number,"vigencia_inicio": string
                  }
                  Insert: {
                    "codigo": string,"id"?: string,"modo_ausencia": string,"referencia": string,"sintetico": boolean,"versao": number,"vigencia_inicio": string
                  }
                  Update: {
                    "codigo"?: string,"id"?: string,"modo_ausencia"?: string,"referencia"?: string,"sintetico"?: boolean,"versao"?: number,"vigencia_inicio"?: string
                  }
                  Relationships: [

                  ]
                },"contas_demo": {
                  Row: {
                    "ativo": boolean,"ator_id": string,"rotulo": string
                  }
                  Insert: {
                    "ativo"?: boolean,"ator_id": string,"rotulo": string
                  }
                  Update: {
                    "ativo"?: boolean,"ator_id"?: string,"rotulo"?: string
                  }
                  Relationships: [

                  ]
                },"decisoes_entrada": {
                  Row: {
                    "ator_id": string,"id": string,"motivo": string,"ocorrido_em": string,"referencia": string | null,"revisao_id": string,"tipo": string
                  }
                  Insert: {
                    "ator_id": string,"id"?: string,"motivo"?: string,"ocorrido_em"?: string,"referencia"?: string | null,"revisao_id": string,"tipo": string
                  }
                  Update: {
                    "ator_id"?: string,"id"?: string,"motivo"?: string,"ocorrido_em"?: string,"referencia"?: string | null,"revisao_id"?: string,"tipo"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "decisoes_entrada_revisao_id_fkey"
      columns: ["revisao_id"]
isOneToOne: false
      referencedRelation: "revisoes_entrada"
      referencedColumns: ["id"]
    }
                  ]
                },"entradas": {
                  Row: {
                    "autor_id": string,"claim_revisao_atual_id": string | null,"competencia_id": string,"escopo_id": string,"estado": string,"id": string,"indicador_id": string,"lock_version": number,"operation_id": string,"posicao_id": string | null,"revisao": number,"revisao_atual_id": string | null,"valor": number | null
                  }
                  Insert: {
                    "autor_id": string,"claim_revisao_atual_id"?: string | null,"competencia_id": string,"escopo_id": string,"estado": string,"id"?: string,"indicador_id": string,"lock_version"?: number,"operation_id": string,"posicao_id"?: string | null,"revisao": number,"revisao_atual_id"?: string | null,"valor"?: number | null
                  }
                  Update: {
                    "autor_id"?: string,"claim_revisao_atual_id"?: string | null,"competencia_id"?: string,"escopo_id"?: string,"estado"?: string,"id"?: string,"indicador_id"?: string,"lock_version"?: number,"operation_id"?: string,"posicao_id"?: string | null,"revisao"?: number,"revisao_atual_id"?: string | null,"valor"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "entradas_claim_revisao_atual_id_fkey"
      columns: ["claim_revisao_atual_id"]
isOneToOne: false
      referencedRelation: "decisoes_entrada"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_entradas_competencia"
      columns: ["competencia_id"]
isOneToOne: false
      referencedRelation: "competencias"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_entradas_escopo"
      columns: ["escopo_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_entradas_indicador"
      columns: ["indicador_id"]
isOneToOne: false
      referencedRelation: "indicadores"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_entradas_posicao"
      columns: ["posicao_id","competencia_id","indicador_id","escopo_id"]
isOneToOne: false
      referencedRelation: "posicoes_esperadas"
      referencedColumns: ["id","competencia_id","indicador_id","alvo_id"]
    },{
      foreignKeyName: "fk_entradas_revisao_atual"
      columns: ["revisao_atual_id","id"]
isOneToOne: false
      referencedRelation: "revisoes_entrada"
      referencedColumns: ["id","entrada_id"]
    }
                  ]
                },"escopos": {
                  Row: {
                    "ativo": boolean,"codigo": string,"distrito_id": string | null,"id": string,"lock_version": number,"tipo": string | null
                  }
                  Insert: {
                    "ativo"?: boolean,"codigo": string,"distrito_id"?: string | null,"id"?: string,"lock_version"?: number,"tipo"?: string | null
                  }
                  Update: {
                    "ativo"?: boolean,"codigo"?: string,"distrito_id"?: string | null,"id"?: string,"lock_version"?: number,"tipo"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "escopos_distrito_id_fkey"
      columns: ["distrito_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    }
                  ]
                },"eventos_auditoria": {
                  Row: {
                    "acao": string,"actor_id": string,"correlacao_id": string | null,"detalhes": NonNullable<Json>,"id": string,"ocorrido_em": string,"recurso_id": string,"recurso_tipo": string
                  }
                  Insert: {
                    "acao": string,"actor_id": string,"correlacao_id"?: string | null,"detalhes"?: NonNullable<Json>,"id"?: string,"ocorrido_em"?: string,"recurso_id": string,"recurso_tipo": string
                  }
                  Update: {
                    "acao"?: string,"actor_id"?: string,"correlacao_id"?: string | null,"detalhes"?: NonNullable<Json>,"id"?: string,"ocorrido_em"?: string,"recurso_id"?: string,"recurso_tipo"?: string
                  }
                  Relationships: [

                  ]
                },"fechamentos": {
                  Row: {
                    "ator_id": string,"competencia_codigo": string | null,"competencia_id": string,"fechado_em": string,"id": string,"referencia_demo": string
                  }
                  Insert: {
                    "ator_id": string,"competencia_codigo"?: string | null,"competencia_id": string,"fechado_em"?: string,"id"?: string,"referencia_demo": string
                  }
                  Update: {
                    "ator_id"?: string,"competencia_codigo"?: string | null,"competencia_id"?: string,"fechado_em"?: string,"id"?: string,"referencia_demo"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fechamentos_competencia_id_fkey"
      columns: ["competencia_id"]
isOneToOne: true
      referencedRelation: "competencias"
      referencedColumns: ["id"]
    }
                  ]
                },"indicadores": {
                  Row: {
                    "codigo": string,"id": string
                  }
                  Insert: {
                    "codigo": string,"id"?: string
                  }
                  Update: {
                    "codigo"?: string,"id"?: string
                  }
                  Relationships: [

                  ]
                },"itens_conjunto": {
                  Row: {
                    "conjunto_id": string,"indicador_id": string,"metadados": NonNullable<Json>,"peso": number,"regra_id": string
                  }
                  Insert: {
                    "conjunto_id": string,"indicador_id": string,"metadados"?: NonNullable<Json>,"peso": number,"regra_id": string
                  }
                  Update: {
                    "conjunto_id"?: string,"indicador_id"?: string,"metadados"?: NonNullable<Json>,"peso"?: number,"regra_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_itens_conjunto_regra_indicador"
      columns: ["regra_id","indicador_id"]
isOneToOne: false
      referencedRelation: "regras"
      referencedColumns: ["id","indicador_id"]
    },{
      foreignKeyName: "itens_conjunto_conjunto_id_fkey"
      columns: ["conjunto_id"]
isOneToOne: false
      referencedRelation: "conjuntos_regra"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "itens_conjunto_indicador_id_fkey"
      columns: ["indicador_id"]
isOneToOne: false
      referencedRelation: "indicadores"
      referencedColumns: ["id"]
    }
                  ]
                },"itens_fechamento": {
                  Row: {
                    "alvo_codigo": string,"alvo_id": string,"alvo_tipo": string | null,"conjunto_id": string | null,"conjunto_versao": number | null,"direcao": string | null,"distrito_codigo": string | null,"distrito_id": string | null,"estado_dado": string,"fator": number | null,"fechamento_id": string,"id": string,"indicador_codigo": string | null,"indicador_id": string | null,"memoria": NonNullable<Json>,"meta": number | null,"metodo": string | null,"modo_ausencia": string | null,"peso": number | null,"peso_efetivo": number | null,"pontos": number | null,"posicao_id": string,"razao": number | null,"regra_id": string,"regra_versao": number | null,"revisao_id": string | null,"revisao_numero": number | null,"unidade_medida": string | null,"valor_entrada": number | null,"valor_resultado": number | null
                  }
                  Insert: {
                    "alvo_codigo"?: string,"alvo_id": string,"alvo_tipo"?: string | null,"conjunto_id"?: string | null,"conjunto_versao"?: number | null,"direcao"?: string | null,"distrito_codigo"?: string | null,"distrito_id"?: string | null,"estado_dado": string,"fator"?: number | null,"fechamento_id": string,"id"?: string,"indicador_codigo"?: string | null,"indicador_id"?: string | null,"memoria": NonNullable<Json>,"meta"?: number | null,"metodo"?: string | null,"modo_ausencia"?: string | null,"peso"?: number | null,"peso_efetivo"?: number | null,"pontos"?: number | null,"posicao_id": string,"razao"?: number | null,"regra_id": string,"regra_versao"?: number | null,"revisao_id"?: string | null,"revisao_numero"?: number | null,"unidade_medida"?: string | null,"valor_entrada"?: number | null,"valor_resultado"?: number | null
                  }
                  Update: {
                    "alvo_codigo"?: string,"alvo_id"?: string,"alvo_tipo"?: string | null,"conjunto_id"?: string | null,"conjunto_versao"?: number | null,"direcao"?: string | null,"distrito_codigo"?: string | null,"distrito_id"?: string | null,"estado_dado"?: string,"fator"?: number | null,"fechamento_id"?: string,"id"?: string,"indicador_codigo"?: string | null,"indicador_id"?: string | null,"memoria"?: NonNullable<Json>,"meta"?: number | null,"metodo"?: string | null,"modo_ausencia"?: string | null,"peso"?: number | null,"peso_efetivo"?: number | null,"pontos"?: number | null,"posicao_id"?: string,"razao"?: number | null,"regra_id"?: string,"regra_versao"?: number | null,"revisao_id"?: string | null,"revisao_numero"?: number | null,"unidade_medida"?: string | null,"valor_entrada"?: number | null,"valor_resultado"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "itens_fechamento_alvo_id_fkey"
      columns: ["alvo_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "itens_fechamento_distrito_id_fkey"
      columns: ["distrito_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "itens_fechamento_fechamento_id_fkey"
      columns: ["fechamento_id"]
isOneToOne: false
      referencedRelation: "fechamentos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "itens_fechamento_indicador_id_fkey"
      columns: ["indicador_id"]
isOneToOne: false
      referencedRelation: "indicadores"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "itens_fechamento_posicao_id_fkey"
      columns: ["posicao_id"]
isOneToOne: false
      referencedRelation: "posicoes_esperadas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "itens_fechamento_regra_id_fkey"
      columns: ["regra_id"]
isOneToOne: false
      referencedRelation: "regras"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "itens_fechamento_revisao_id_fkey"
      columns: ["revisao_id"]
isOneToOne: false
      referencedRelation: "revisoes_entrada"
      referencedColumns: ["id"]
    }
                  ]
                },"operacoes_dominio": {
                  Row: {
                    "ator_id": string,"comando": string,"id": string,"ocorrido_em": string,"operation_id": string,"payload": NonNullable<Json>,"resposta": NonNullable<Json>
                  }
                  Insert: {
                    "ator_id": string,"comando": string,"id"?: string,"ocorrido_em"?: string,"operation_id": string,"payload": NonNullable<Json>,"resposta": NonNullable<Json>
                  }
                  Update: {
                    "ator_id"?: string,"comando"?: string,"id"?: string,"ocorrido_em"?: string,"operation_id"?: string,"payload"?: NonNullable<Json>,"resposta"?: NonNullable<Json>
                  }
                  Relationships: [

                  ]
                },"pontuacoes_fechamento": {
                  Row: {
                    "alvo_codigo": string,"alvo_id": string,"completo": boolean,"conjunto_id": string,"conjunto_versao": number,"distrito_id": string | null,"fechamento_id": string,"pontos": number | null,"sem_base": boolean
                  }
                  Insert: {
                    "alvo_codigo": string,"alvo_id": string,"completo": boolean,"conjunto_id": string,"conjunto_versao": number,"distrito_id"?: string | null,"fechamento_id": string,"pontos"?: number | null,"sem_base": boolean
                  }
                  Update: {
                    "alvo_codigo"?: string,"alvo_id"?: string,"completo"?: boolean,"conjunto_id"?: string,"conjunto_versao"?: number,"distrito_id"?: string | null,"fechamento_id"?: string,"pontos"?: number | null,"sem_base"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "pontuacoes_fechamento_alvo_id_fkey"
      columns: ["alvo_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pontuacoes_fechamento_fechamento_id_fkey"
      columns: ["fechamento_id"]
isOneToOne: false
      referencedRelation: "fechamentos"
      referencedColumns: ["id"]
    }
                  ]
                },"posicoes_esperadas": {
                  Row: {
                    "alvo_id": string,"aplicavel": boolean,"competencia_id": string,"id": string,"indicador_id": string,"informante_id": string,"lock_version": number,"regra_id": string,"revisor_id": string
                  }
                  Insert: {
                    "alvo_id": string,"aplicavel"?: boolean,"competencia_id": string,"id"?: string,"indicador_id": string,"informante_id": string,"lock_version"?: number,"regra_id": string,"revisor_id": string
                  }
                  Update: {
                    "alvo_id"?: string,"aplicavel"?: boolean,"competencia_id"?: string,"id"?: string,"indicador_id"?: string,"informante_id"?: string,"lock_version"?: number,"regra_id"?: string,"revisor_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_posicoes_regra_indicador"
      columns: ["regra_id","indicador_id"]
isOneToOne: false
      referencedRelation: "regras"
      referencedColumns: ["id","indicador_id"]
    },{
      foreignKeyName: "posicoes_esperadas_alvo_id_fkey"
      columns: ["alvo_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "posicoes_esperadas_competencia_id_fkey"
      columns: ["competencia_id"]
isOneToOne: false
      referencedRelation: "competencias"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "posicoes_esperadas_indicador_id_fkey"
      columns: ["indicador_id"]
isOneToOne: false
      referencedRelation: "indicadores"
      referencedColumns: ["id"]
    }
                  ]
                },"publicacoes": {
                  Row: {
                    "ator_id": string,"fechamento_id": string,"id": string,"publicado_em": string,"referencia_demo": string
                  }
                  Insert: {
                    "ator_id": string,"fechamento_id": string,"id"?: string,"publicado_em"?: string,"referencia_demo": string
                  }
                  Update: {
                    "ator_id"?: string,"fechamento_id"?: string,"id"?: string,"publicado_em"?: string,"referencia_demo"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "publicacoes_fechamento_id_fkey"
      columns: ["fechamento_id"]
isOneToOne: true
      referencedRelation: "fechamentos"
      referencedColumns: ["id"]
    }
                  ]
                },"regras": {
                  Row: {
                    "casas_decimais": number | null,"direcao": string | null,"fator": number | null,"id": string,"indicador_id": string,"meta": number | null,"metodo": string,"nome": string | null,"unidade_medida": string | null,"valor_maximo": number | null,"versao": number,"vigencia_fim": string | null,"vigencia_inicio": string
                  }
                  Insert: {
                    "casas_decimais"?: number | null,"direcao"?: string | null,"fator"?: number | null,"id"?: string,"indicador_id": string,"meta"?: number | null,"metodo"?: string,"nome"?: string | null,"unidade_medida"?: string | null,"valor_maximo"?: number | null,"versao": number,"vigencia_fim"?: string | null,"vigencia_inicio": string
                  }
                  Update: {
                    "casas_decimais"?: number | null,"direcao"?: string | null,"fator"?: number | null,"id"?: string,"indicador_id"?: string,"meta"?: number | null,"metodo"?: string,"nome"?: string | null,"unidade_medida"?: string | null,"valor_maximo"?: number | null,"versao"?: number,"vigencia_fim"?: string | null,"vigencia_inicio"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_regras_indicador"
      columns: ["indicador_id"]
isOneToOne: false
      referencedRelation: "indicadores"
      referencedColumns: ["id"]
    }
                  ]
                },"resultados": {
                  Row: {
                    "entrada_id": string,"id": string,"memoria": NonNullable<Json>,"regra_id": string,"revisao_id": string | null,"valor": number
                  }
                  Insert: {
                    "entrada_id": string,"id"?: string,"memoria": NonNullable<Json>,"regra_id": string,"revisao_id"?: string | null,"valor": number
                  }
                  Update: {
                    "entrada_id"?: string,"id"?: string,"memoria"?: NonNullable<Json>,"regra_id"?: string,"revisao_id"?: string | null,"valor"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_resultados_entrada"
      columns: ["entrada_id"]
isOneToOne: false
      referencedRelation: "entradas"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_resultados_regra"
      columns: ["regra_id"]
isOneToOne: false
      referencedRelation: "regras"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fk_resultados_revisao"
      columns: ["revisao_id","entrada_id"]
isOneToOne: false
      referencedRelation: "revisoes_entrada"
      referencedColumns: ["id","entrada_id"]
    }
                  ]
                },"revisoes_entrada": {
                  Row: {
                    "autor_id": string,"entrada_id": string,"enviada_em": string | null,"estado_dado": string,"explicacao_correcao": string | null,"id": string,"motivo": string,"numero": number,"origem": string,"periodo_fonte": string,"valor": number | null
                  }
                  Insert: {
                    "autor_id": string,"entrada_id": string,"enviada_em"?: string | null,"estado_dado": string,"explicacao_correcao"?: string | null,"id"?: string,"motivo"?: string,"numero": number,"origem"?: string,"periodo_fonte"?: string,"valor"?: number | null
                  }
                  Update: {
                    "autor_id"?: string,"entrada_id"?: string,"enviada_em"?: string | null,"estado_dado"?: string,"explicacao_correcao"?: string | null,"id"?: string,"motivo"?: string,"numero"?: number,"origem"?: string,"periodo_fonte"?: string,"valor"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "revisoes_entrada_entrada_id_fkey"
      columns: ["entrada_id"]
isOneToOne: false
      referencedRelation: "entradas"
      referencedColumns: ["id"]
    }
                  ]
                },"territorios_competencia": {
                  Row: {
                    "competencia_id": string,"distrito_id": string,"unidade_id": string
                  }
                  Insert: {
                    "competencia_id": string,"distrito_id": string,"unidade_id": string
                  }
                  Update: {
                    "competencia_id"?: string,"distrito_id"?: string,"unidade_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "territorios_competencia_competencia_id_fkey"
      columns: ["competencia_id"]
isOneToOne: false
      referencedRelation: "competencias"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "territorios_competencia_distrito_id_fkey"
      columns: ["distrito_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "territorios_competencia_unidade_id_fkey"
      columns: ["unidade_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    }
                  ]
                },"vinculos": {
                  Row: {
                    "actor_id": string,"ativo": boolean,"escopo_id": string,"id": string,"indicador_id": string | null,"lock_version": number,"papel": string,"vigencia_fim": string | null,"vigencia_inicio": string | null
                  }
                  Insert: {
                    "actor_id": string,"ativo"?: boolean,"escopo_id": string,"id"?: string,"indicador_id"?: string | null,"lock_version"?: number,"papel": string,"vigencia_fim"?: string | null,"vigencia_inicio"?: string | null
                  }
                  Update: {
                    "actor_id"?: string,"ativo"?: boolean,"escopo_id"?: string,"id"?: string,"indicador_id"?: string | null,"lock_version"?: number,"papel"?: string,"vigencia_fim"?: string | null,"vigencia_inicio"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fk_vinculos_escopo"
      columns: ["escopo_id"]
isOneToOne: false
      referencedRelation: "escopos"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "vinculos_indicador_id_fkey"
      columns: ["indicador_id"]
isOneToOne: false
      referencedRelation: "indicadores"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "authorize_position_correction":
{ Args: { "p_contexto": Json,"p_expected_version": number,"p_operation_id": string,"p_position_id": string,"p_reason": string }; Returns: Json
                           },
"correct_position":
{ Args: { "p_contexto": Json,"p_expected_version": number,"p_input": Json,"p_operation_id": string,"p_position_id": string }; Returns: Json
                           },
"decide_unavailability":
{ Args: { "p_contexto": Json,"p_expected_version": number,"p_operation_id": string,"p_position_id": string,"p_reason": string,"p_reference": string }; Returns: Json
                           },
"get_admin_catalog":
{ Args: { "p_contexto": Json }; Returns: Json
                           },
"get_authorized_contexts":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_cycle_checklist":
{ Args: { "p_contexto": Json }; Returns: Json
                           },
"get_dashboard":
{ Args: { "p_contexto": Json }; Returns: Json
                           },
"get_demo_configuration":
{ Args: { "p_contexto": Json }; Returns: Json
                           },
"get_leadership_aggregates":
{ Args: { "p_contexto": Json }; Returns: Json
                           },
"get_my_evaluations":
{ Args: { "p_contexto": Json,"p_filters": Json,"p_view": string }; Returns: Json
                           },
"get_operational_positions":
{ Args: { "p_contexto": Json,"p_filters": Json }; Returns: Json
                           },
"get_position_detail":
{ Args: { "p_contexto": Json,"p_position_id": string }; Returns: Json
                           },
"get_rule_catalog":
{ Args: { "p_contexto": Json }; Returns: Json
                           },
"get_scoped_audit":
{ Args: { "p_contexto": Json,"p_filters": Json }; Returns: Json
                           },
"get_snapshot_export":
{ Args: { "p_contexto": Json,"p_operation_id": string,"p_snapshot_id": string }; Returns: Json
                           },
"get_unit_batch":
{ Args: { "p_contextos": Json,"p_unidade_id": string }; Returns: Json
                           },
"get_unit_results":
{ Args: { "p_contexto": Json }; Returns: Json
                           },
"open_demo_competence":
{ Args: { "p_assignments": Json,"p_contexto": Json,"p_operation_id": string,"p_reference": string }; Returns: Json
                           },
"publish_cycle_demo":
{ Args: { "p_contexto": Json,"p_operation_id": string,"p_reference": string,"p_snapshot_id": string }; Returns: Json
                           },
"reassign_demo_position":
{ Args: { "p_contexto": Json,"p_expected_version": number,"p_input": Json,"p_operation_id": string,"p_position_id": string,"p_reason": string }; Returns: Json
                           },
"review_position":
{ Args: { "p_contexto": Json,"p_decision": string,"p_expected_version": number,"p_operation_id": string,"p_position_id": string,"p_reason": string }; Returns: Json
                           },
"save_demo_scope":
{ Args: { "p_contexto": Json,"p_expected_version": number,"p_input": Json,"p_operation_id": string,"p_scope_id": string }; Returns: Json
                           },
"save_position_draft":
{ Args: { "p_contexto": Json,"p_expected_version": number,"p_input": Json,"p_operation_id": string,"p_position_id": string }; Returns: Json
                           },
"schedule_demo_rule":
{ Args: { "p_contexto": Json,"p_factor": string,"p_operation_id": string,"p_reference": string,"p_start_month": string }; Returns: Json
                           },
"set_demo_business_link":
{ Args: { "p_actor_id": string,"p_contexto": Json,"p_expected_version": number,"p_input": Json,"p_operation_id": string }; Returns: Json
                           },
"start_position_review":
{ Args: { "p_contexto": Json,"p_expected_version": number,"p_operation_id": string,"p_position_id": string }; Returns: Json
                           },
"submit_demo_entry":
{ Args: { "p_competencia_id": string,"p_escopo_id": string,"p_indicador_id": string,"p_operation_id": string,"p_valor_texto": string }; Returns: Json
                           },
"submit_position":
{ Args: { "p_contexto": Json,"p_expected_version": number,"p_operation_id": string,"p_position_id": string }; Returns: Json
                           },
"submit_unit_batch":
{ Args: { "p_itens": Json,"p_operation_id": string }; Returns: Json
                           },
"transition_cycle":
{ Args: { "p_action": string,"p_contexto": Json,"p_expected_version": number,"p_operation_id": string,"p_reason": string,"p_reference": string }; Returns: Json
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {

          }
        }
} as const
