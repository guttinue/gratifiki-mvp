// Canonical application boundary contracts. Decimal text is validated by decoders;
// do not turn it into JavaScript Number for business arithmetic.
export type Role = 'area_tecnica' | 'revisor_tecnico' | 'cam' | 'gestor_unidade' |
  'gestor_distrital' | 'administrador' | 'lideranca';
export type DecimalText = string;
export type CommandContext = { vinculoId: string; competenciaId: string; indicadorId: string };
export type AuthorizedContext = CommandContext & { key: string; actorId: string; role: Role;
  escopoId: string; escopoCodigo: string; competenciaCodigo: string; mode: 'legacy' | 'academic' };
export type EntryStatus = 'rascunho' | 'enviada' | 'em_revisao' | 'devolvida' | 'validada' | 'invalidada';
export type DraftInput = { estadoDado: 'valor' | 'indisponivel'; valor: DecimalText | null;
  fonte: string; periodoFonte: string; motivo: string };
export type CommandReceipt = { resourceId: string; version: number; revisionId: string | null;
  status: string; resultValue: DecimalText | null };
export type DomainErrorCode = 'access_denied' | 'invalid_input' | 'version_conflict' |
  'operation_payload_mismatch' | 'invalid_state' | 'rule_unavailable' | 'network_error';
export type PositionSummary = { id: string; escopoId: string; escopoCodigo: string;
  escopoTipo: 'unidade' | 'distrito'; aplicavel: boolean; status: EntryStatus | 'ausente';
  estadoDado: 'valor' | 'indisponivel' | 'nao_aplicavel' | null; version: number;
  revisionId: string | null; inputValue: DecimalText | null; resultValue: DecimalText | null };
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
export type PositionFilter = { status?: string; search?: string; page: number; pageSize: number };
export type EvaluationItem = Pick<PositionSummary,'id'|'escopoId'|'escopoCodigo'|'escopoTipo'|
  'estadoDado'|'inputValue'|'resultValue'> & { ruleVersion: number;
  publication: 'preliminar' | 'publicada_demo'; snapshotId: string | null };
export type DashboardData = { expected: number; received: number; reviewed: number;
  unavailable: number; cards: { id: string; label: string; count: number; filter: PositionFilter | null }[] };
export type CycleChecklist = { version: number; expected: number; received: number;
  reviewed: number; decidedUnavailable: number; canConsolidate: boolean; canClose: boolean;
  state: 'aberta'|'em_consolidacao'|'fechada'; unavailable:number; notApplicable:number;
  fullCoverage:boolean; snapshotId:string|null; publication:'nao_publicada'|'publicada_demo'; publicationId:string|null;
  blockers: { positionId: string | null; code: string; message: string }[] };
export type AggregateRow = { competencia: string; distritoCodigo: string; unidadeMedida: string;
  publishedUnits: number; calculableUnits: number; resultSum: DecimalText | null };
export type AuditItem = { id: string; occurredAt: string; action: string; resourceId: string;
  version: number | null; reason: string | null };
export type ExportRow = { snapshotId: string; competencia: string; indicador: string; alvoTipo: string;
  alvoCodigo: string; regraVersao: number; revisao: number | null; estadoDado: string;
  entrada: DecimalText | null; fator: DecimalText | null; resultado: DecimalText | null;
  publicacao: 'nao_publicada' | 'publicada_demo' };
export type ExportBundle = { contractVersion: 1; snapshotId: string; rows: ExportRow[];
  manifest: { competencia: string; ruleVersions: number[]; publicationVersion: 0 | 1;
    positionCount: number; calculableCount: number; unavailableCount: number;
    notApplicableCount: number; totals: { tipo: string; unidadeMedida: string; sum: DecimalText }[] } };
