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
  entryId: string;
  resultId: string;
  competenciaId: string;
  competenciaCodigo: string;
  indicadorId: string;
  indicadorCodigo: string;
  escopoId: string;
  escopoCodigo: string;
  inputValue: string;
  resultValue: string;
  state: EntryState;
  revision: number;
  operationId: string;
  ruleId: string;
  ruleVersion: number;
  factor: string;
}

export interface PilotAuditEvent {
  id: string;
  entryId: string;
  action: string;
  occurredAt: string;
}

export interface PilotEntry {
  id: string;
  competenciaId: string;
  competenciaCodigo: string;
  indicadorId: string;
  indicadorCodigo: string;
  escopoId: string;
  escopoCodigo: string;
  inputValue: string;
  state: EntryState;
  revision: number;
  operationId: string;
  results: ResultMemory[];
  auditEvents: PilotAuditEvent[];
  submittedAt: string | null;
}

export type SubmitResult = {
  entryId: string;
  resultId: string;
  resultValue: string;
  ruleVersion: number;
  operationId: string;
};
