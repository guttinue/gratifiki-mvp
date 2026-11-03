import type { SupabaseClient } from "@supabase/supabase-js";
import type { CommandContext, CommandReceipt, DraftInput, Page, PositionFilter, PositionSummary } from "../pilot/types";
import { parseInputDecimal } from '../pilot/decimal';
import { DomainCommandError, runCommand } from '../pilot/commandApi';
export type PositionRevision = { id: string; number: number; authorId: string; estadoDado: DraftInput['estadoDado']; value: string | null; source: string; sourcePeriod: string; reason: string; submittedAt: string | null;
  // What a model-3 correction changed (R-25); null on any other revision.
  correctionExplanation: string | null };
export type PositionDecision = { id: string; revisionId: string; actorId: string; type: 'iniciar_revisao' | 'validar' | 'devolver' | 'autorizar_retificacao' | 'decidir_indisponibilidade'; reason: string; reference: string | null; occurredAt: string };
type FactorMemory = { revisionId: string; ruleVersion: number; factor: string; inputValue: string; resultValue: string };
// A meta/weight result has no factor; its points and expression are read elsewhere.
export type PositionMemory = FactorMemory | (Omit<FactorMemory, 'factor'> & { method: 'meta_peso'; factor: null });
export type PositionDetail = { position: PositionSummary; revisions: PositionRevision[]; decisions: PositionDecision[]; memories: PositionMemory[] };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid position response');
  return value as Record<string, unknown>;
}
function text(value: unknown, empty = false): string { if (typeof value !== 'string' || (!empty && !value.trim())) throw new Error('Invalid position text'); return value; }
function integer(value: unknown, minimum = 1): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid position integer'); return value; }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function decimal(value: unknown): string { const result = text(value); if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(result)) throw new Error('Invalid decimal text'); return result; }
function nullableDecimal(value: unknown): string | null { return value === null ? null : decimal(value); }
function choice<T extends string>(value: unknown, allowed: readonly T[]): T { if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('Invalid position enum'); return value as T; }
function array<T>(value: unknown, decode: (item: unknown) => T): T[] { if (!Array.isArray(value)) throw new Error('Invalid position collection'); return value.map(decode); }
function position(value: unknown): PositionSummary {
  const row = object(value);
  if (typeof row.aplicavel !== 'boolean') throw new Error('Invalid applicability');
  return { id: text(row.id), escopoId: text(row.escopoId), escopoCodigo: text(row.escopoCodigo), escopoTipo: choice(row.escopoTipo, ['unidade','distrito']), aplicavel: row.aplicavel,
    status: choice(row.status, ['ausente','rascunho','enviada','em_revisao','devolvida','validada','invalidada']),
    estadoDado: row.estadoDado === null ? null : choice(row.estadoDado, ['valor','indisponivel','nao_aplicavel'] as const), version: integer(row.version),
    revisionId: nullableText(row.revisionId), inputValue: nullableDecimal(row.inputValue), resultValue: nullableDecimal(row.resultValue) };
}
function commandContext(context: CommandContext): CommandContext { return { vinculoId: context.vinculoId, competenciaId: context.competenciaId, indicadorId: context.indicadorId }; }
export function normalizeDraftInput(input:DraftInput):DraftInput {
  return {...input,valor:input.valor===null?null:parseInputDecimal(input.valor),fonte:input.fonte.trim(),periodoFonte:input.periodoFonte.trim(),motivo:input.motivo.trim()};
}
export async function saveDraft(client:SupabaseClient,context:CommandContext,positionId:string,expectedVersion:number,input:DraftInput,operationId:string):Promise<CommandReceipt> {
  const normalized=normalizeDraftInput(input);
  const receipt=await runCommand<CommandReceipt>(client,'save_position_draft',context,{p_position_id:positionId,p_expected_version:expectedVersion,p_input:normalized},operationId);
  if(receipt.resourceId!==positionId||!receipt.revisionId||receipt.status!=='rascunho'||receipt.resultValue!==null)throw new DomainCommandError('invalid_input');
  return receipt;
}
export async function listPositions(client: SupabaseClient, context: CommandContext, filters: PositionFilter): Promise<Page<PositionSummary>> {
  const { data, error } = await client.rpc('get_operational_positions', { p_contexto: commandContext(context), p_filters: filters });
  if (error) throw error;
  const row = object(data); const pageSize = integer(row.pageSize);
  if (pageSize > 100) throw new Error('Invalid page size');
  return { items: array(row.items, position), total: integer(row.total, 0), page: integer(row.page), pageSize };
}
export async function loadPositionDetail(client: SupabaseClient, context: CommandContext, id: string): Promise<PositionDetail> {
  const { data, error } = await client.rpc('get_position_detail', { p_contexto: commandContext(context), p_position_id: id });
  if (error) throw error;
  const row = object(data);
  return { position: position(row.position), revisions: array(row.revisions, item => {
    const r = object(item); return { id: text(r.id), number: integer(r.number), authorId: text(r.authorId), estadoDado: choice(r.estadoDado, ['valor','indisponivel','nao_aplicavel'] as const), value: nullableDecimal(r.value), source: text(r.source,true), sourcePeriod: text(r.sourcePeriod,true), reason: text(r.reason,true), submittedAt: nullableText(r.submittedAt),
      // Absent only from servers before T10, which never stored one.
      correctionExplanation: r.correctionExplanation === undefined ? null : nullableText(r.correctionExplanation) };
  }), decisions: array(row.decisions, item => {
    const r = object(item); return { id: text(r.id), revisionId: text(r.revisionId), actorId: text(r.actorId), type: choice(r.type, ['iniciar_revisao','validar','devolver','autorizar_retificacao','decidir_indisponibilidade']), reason: text(r.reason,true), reference: nullableText(r.reference), occurredAt: text(r.occurredAt) };
  }), memories: array(row.memories, item => {
    const r = object(item);
    const common = { revisionId: text(r.revisionId), ruleVersion: integer(r.ruleVersion), inputValue: decimal(r.inputValue), resultValue: decimal(r.resultValue) };
    if (r.method === 'meta_peso') {
      if (r.factor !== null) throw new Error('Invalid meta/weight memory');
      return { ...common, method: 'meta_peso', factor: null };
    }
    // Factor memories (method 'fator', or absent from older servers) stay strict.
    if (r.method !== undefined && r.method !== 'fator') throw new Error('Invalid memory method');
    return { ...common, factor: decimal(r.factor) };
  }) };
}
