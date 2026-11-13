import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandReceipt, DecimalText, DomainErrorCode, DraftInput, EntryStatus } from '../pilot/types';
import { DomainCommandError, decodeCommandReceipt } from '../pilot/commandApi';
import { normalizeDraftInput } from '../submission/positionApi';
import { readArray, readDecimal, readInteger, readObject, readText } from '../workspace/academicDashboardApi';
import { absenceModes, readDate, readExact, readOneOf, type AbsenceMode, type Direction } from '../results/resultsApi';

// Model-3 unit batch (T10). The server authorizes every item against its own
// link; decimals stay text and are never turned into JavaScript numbers.
export type UnitBatchItem = { positionId: string; indicatorCode: string; name: string; meta: DecimalText; direction: Direction;
  weight: DecimalText; decimals: number; max: DecimalText; unit: string | null; status: EntryStatus | 'ausente'; version: number;
  estadoDado: DraftInput['estadoDado'] | null; valor: DecimalText | null; fonte: string | null; motivo: string | null;
  // The current revision's source period (YYYY-MM-DD); null when none was saved.
  periodoFonte: string | null; returnReason: string | null; revisionNumber: number | null };
// mode: the absence mode of the competence's rule set.
export type UnitBatch = { unitId: string; unitCode: string; mode: AbsenceMode; items: UnitBatchItem[] };
// A returned position needs the explanation of what changed; others send null.
export type BatchItem = { context: CommandContext; positionId: string; expectedVersion: number; input: DraftInput; correction: { explanation: string } | null };

const codes: readonly DomainErrorCode[] = ['access_denied', 'invalid_input', 'version_conflict', 'operation_payload_mismatch', 'invalid_state', 'rule_unavailable'];
// A batch failure; positionId names the item that aborted the whole batch.
export class BatchCommandError extends DomainCommandError {
  readonly positionId?: string;
  constructor(code: DomainErrorCode, confirmedRejected: boolean, positionId?: string) {
    super(code, confirmedRejected);
    this.name = 'BatchCommandError';
    this.positionId = positionId;
  }
}

function invalid(): never { throw new DomainCommandError('invalid_input'); }
const nullable = <T,>(value: unknown, read: (v: unknown) => T): T | null => value === null ? null : read(value);
const decimal = (value: unknown): DecimalText => readDecimal(value) ?? invalid();
const anyText = (value: unknown): string => typeof value === 'string' ? value : invalid();
const statuses = ['ausente', 'rascunho', 'enviada', 'em_revisao', 'devolvida', 'validada', 'invalidada'] as const;
const itemKeys = ['positionId', 'indicatorCode', 'name', 'meta', 'direction', 'weight', 'decimals', 'max', 'unit', 'status', 'version',
  'estadoDado', 'valor', 'fonte', 'motivo', 'periodoFonte', 'returnReason', 'revisionNumber'] as const;

function decodeItem(value: unknown): UnitBatchItem {
  const r = readExact(value, itemKeys);
  return { positionId: readText(r.positionId), indicatorCode: readText(r.indicatorCode), name: readText(r.name), meta: decimal(r.meta),
    direction: readOneOf(r.direction, ['maior_melhor', 'menor_melhor'] as const), weight: decimal(r.weight), decimals: readInteger(r.decimals),
    max: decimal(r.max), unit: nullable(r.unit, readText), status: readOneOf(r.status, statuses), version: readInteger(r.version, 1),
    estadoDado: nullable(r.estadoDado, v => readOneOf(v, ['valor', 'indisponivel', 'nao_aplicavel'] as const)), valor: nullable(r.valor, decimal),
    fonte: nullable(r.fonte, anyText), motivo: nullable(r.motivo, anyText), periodoFonte: nullable(r.periodoFonte, readDate), returnReason: nullable(r.returnReason, readText),
    revisionNumber: nullable(r.revisionNumber, v => readInteger(v, 1)) };
}
export function decodeUnitBatch(value: unknown): UnitBatch {
  const r = readExact(value, ['unitId', 'unitCode', 'mode', 'items']);
  const batch = { unitId: readText(r.unitId), unitCode: readText(r.unitCode), mode: readOneOf(r.mode, absenceModes), items: readArray(r.items, decodeItem) };
  if (!batch.items.length || new Set(batch.items.map(i => i.positionId)).size !== batch.items.length) return invalid();
  return batch;
}
const commandContext = (c: CommandContext): CommandContext => ({ vinculoId: c.vinculoId, competenciaId: c.competenciaId, indicadorId: c.indicadorId });

// PostgREST error → domain code; an item failure carries DETAIL {"positionId","code"}.
function batchError(error: unknown): BatchCommandError {
  const row = error && typeof error === 'object' ? readObject(error) : {};
  if (row.code === '42501') return new BatchCommandError('access_denied', true);
  if (row.code === '40001') return new BatchCommandError('version_conflict', true);
  if (row.code === '55000') return new BatchCommandError('invalid_state', true);
  if (row.code !== '22023') return new BatchCommandError('network_error', false);
  if (typeof row.details === 'string') {
    try {
      const detail = readExact(JSON.parse(row.details), ['positionId', 'code']);
      return new BatchCommandError(readOneOf(detail.code, codes), true, readText(detail.positionId));
    } catch { /* not an item detail: fall back to the message */ }
  }
  return new BatchCommandError(row.message === 'operation_payload_mismatch' || row.message === 'rule_unavailable' ? row.message : 'invalid_input', true);
}

export async function loadUnitBatch(client: SupabaseClient, contexts: CommandContext[], unitId: string): Promise<UnitBatch> {
  const { data, error } = await client.rpc('get_unit_batch', { p_contextos: contexts.map(commandContext), p_unidade_id: unitId });
  if (error) throw batchError(error);
  return decodeUnitBatch(data);
}

// All or nothing: either every item is sent and has its receipt, or nothing is.
export async function submitUnitBatch(client: SupabaseClient, items: BatchItem[], operationId: string): Promise<CommandReceipt[]> {
  const p_itens = items.map(item => ({ contexto: commandContext(item.context), positionId: item.positionId, expectedVersion: item.expectedVersion,
    input: normalizeDraftInput(item.input), correction: item.correction && { explanation: item.correction.explanation.trim() } }));
  let response;
  try { response = await client.rpc('submit_unit_batch', { p_itens, p_operation_id: operationId }); }
  catch (error) { throw batchError(error); }
  if (response.error) throw batchError(response.error);
  const receipts = readArray(readExact(response.data, ['items']).items, decodeCommandReceipt);
  const ids = new Set(items.map(item => item.positionId));
  if (receipts.length !== ids.size || receipts.some(r => !ids.delete(r.resourceId) || r.status !== 'enviada')) return invalid();
  return receipts;
}
