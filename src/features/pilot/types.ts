// Canonical application boundary contracts. Decimal text is validated by decoders;
// do not turn it into JavaScript Number for business arithmetic.
export type Role = 'area_tecnica' | 'revisor_tecnico' | 'cam' | 'gestor_unidade' |
  'gestor_distrital' | 'administrador' | 'lideranca';
export type DecimalText = string;
export type CommandContext = { vinculoId: string; competenciaId: string; indicadorId: string };
export type CompetenceState = 'aberta' | 'em_revisao' | 'em_consolidacao' | 'fechada' | 'invalidada';
export type AuthorizedContext = CommandContext & { key: string; actorId: string; role: Role;
  escopoId: string; escopoCodigo: string; competenciaCodigo: string; mode: 'legacy' | 'academic';
  modelo: 1 | 2 | 3; competenciaEstado?: CompetenceState };
// One role, competence and scope with all the indicators the actor may use there.
// The server still authorizes each context; the group only shapes the screens.
export type ContextGroup = { key: string; role: Role; modelo: 1 | 2 | 3; competenciaId: string;
  competenciaCodigo: string; escopoId: string; escopoCodigo: string; contexts: AuthorizedContext[] };
export type EntryStatus = 'rascunho' | 'enviada' | 'em_revisao' | 'devolvida' | 'validada' | 'invalidada';
export type DraftInput = { estadoDado: 'valor' | 'indisponivel' | 'nao_aplicavel'; valor: DecimalText | null;
  fonte: string; periodoFonte: string; motivo: string };
export type CommandReceipt = { resourceId: string; version: number; revisionId: string | null;
  status: string; resultValue: DecimalText | null };
export type DomainErrorCode = 'access_denied' | 'invalid_input' | 'version_conflict' |
  'operation_payload_mismatch' | 'invalid_state' | 'rule_unavailable' | 'network_error';
export type PositionSummary = { id: string; escopoId: string; escopoCodigo: string;
  escopoTipo: 'unidade' | 'distrito'; aplicavel: boolean; status: EntryStatus | 'ausente';
  estadoDado: 'valor' | 'indisponivel' | 'nao_aplicavel' | null; version: number;
  revisionId: string | null; inputValue: DecimalText | null; resultValue: DecimalText | null;
  // Model 3 only (R-28): which indicator the position is.
  indicatorCode?: string; indicatorName?: string };
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
  // Model 3 only: positions with a final situation (value, or unavailable/not applicable decided).
  ready?:number;
  blockers: { positionId: string | null; code: string; message: string }[] };
export type AggregateRow = { competencia: string; distritoCodigo: string; unidadeMedida: string;
  publishedUnits: number; calculableUnits: number; resultSum: DecimalText | null };
export type AuditItem = { id: string; occurredAt: string; action: string; resourceId: string;
  version: number | null; reason: string | null };
export type ExportRow = { snapshotId: string; competencia: string; indicador: string; alvoTipo: string;
  alvoCodigo: string; regraVersao: number; revisao: number | null; estadoDado: string;
  entrada: DecimalText | null; fator: DecimalText | null; resultado: DecimalText | null;
  publicacao: 'nao_publicada' | 'publicada_demo' };
export type ExportManifest = { competencia: string; ruleVersions: number[]; publicationVersion: 0 | 1;
  positionCount: number; calculableCount: number; unavailableCount: number;
  notApplicableCount: number; totals: { tipo: string; unidadeMedida: string; sum: DecimalText }[] };
// Model 3 (contract version 2): frozen meta/weight calculation per row.
export type Model3ExportRow = { snapshotId: string; competencia: string; indicador: string; alvoTipo: string;
  alvoCodigo: string; regraVersao: number; revisao: number | null; situacaoDado: 'valor' | 'indisponivel' | 'nao_aplicavel';
  valor: DecimalText | null; meta: DecimalText; peso: DecimalText; pesoEfetivo: DecimalText | null; pontos: DecimalText | null;
  conjunto: string; conjuntoVersao: number; sintetico: boolean; publicacao: 'nao_publicada' | 'publicada_demo' };
export type ExportBundle = { contractVersion: 1; snapshotId: string; rows: ExportRow[]; manifest: ExportManifest }
  | { contractVersion: 2; snapshotId: string; rows: Model3ExportRow[]; manifest: ExportManifest };
// Model-3 leadership: no person, no individual value; averages over complete units.
export type LeadershipOverview = { acceptedPercent: string;
  districts: { districtCode: string; average: string | null; completeUnits: number; totalUnits: number }[];
  attention: { unitCode: string; pending: number }[] };
