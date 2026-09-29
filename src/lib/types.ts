export type CompetenceState = "aberta" | "em_revisao" | "fechada" | "invalidada";

export type EntryState = "pendente" | "validada" | "corrigida" | "fechada" | "invalidada";

export interface PilotContext {
  actorId: string;
  papel: "area_tecnica" | "cam";
  competenciaId: string;
  competenciaCodigo: string;
  referencia: string;
  indicadorId: string;
  indicadorCodigo: string;
  escopoId: string;
  escopoCodigo: string;
}

export interface Entry {
  id: string;
  competenciaId: string;
  indicadorId: string;
  escopoId: string;
  autorId: string;
  valor: number;
  estado: EntryState;
  revisao: number;
  operationId: string;
}

export interface ResultMemory {
  ruleId: string;
  ruleVersion: number;
  inputs: Record<string, number | string | boolean | null>;
  terms: Array<{ label: string; value: number | string }>;
}
