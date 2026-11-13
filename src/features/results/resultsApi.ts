import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, DecimalText } from '../pilot/types';
import { DomainCommandError } from '../pilot/commandApi';
import { readArray, readDecimal, readInteger, readObject, readRpc, readText } from '../workspace/academicDashboardApi';

// Model-3 read contracts. Decimals stay text (pilot/decimal.ts formats them);
// official points never become a JavaScript number.
export type Direction = 'maior_melhor' | 'menor_melhor';
// Absence mode of a rule set: zero (an unavailable/not applicable item scores 0)
// or redistribuir (its weight goes to the other indicators).
export type AbsenceMode = 'zero' | 'redistribuir';
export const absenceModes: readonly AbsenceMode[] = ['zero', 'redistribuir'];
export type ResultItemState = 'valor' | 'indisponivel' | 'nao_aplicavel' | 'pendente';
export type ReviewStatus = 'valor' | 'indisponivel' | 'nao_aplicavel' | 'sem_envio' | 'em_conferencia' | 'decisao_pendente';
export type UnitResultItem = { indicatorCode: string; name: string; state: ResultItemState; inputValue: DecimalText | null;
  meta: DecimalText; direction: Direction; weight: DecimalText; effectiveWeight: DecimalText | null; points: DecimalText | null;
  expression: string | null; reviewStatus: ReviewStatus };
export type UnitResult = { unitId: string; unitCode: string; districtCode: string; points: DecimalText | null; complete: boolean;
  noBase: boolean; partial: boolean; previous: { points: DecimalText | null; competencia: string } | null;
  // Signed, two decimal places (e.g. "4.80"); only between two complete scores.
  delta: string | null; items: UnitResultItem[] };
export type UnitResults = { competencia: string; state: 'aberta' | 'em_consolidacao' | 'fechada';
  publication: 'nao_publicada' | 'publicada_demo'; mode: AbsenceMode; units: UnitResult[] };
export type RuleSetItem = { indicatorCode: string; name: string; meta: DecimalText; direction: Direction; decimals: number;
  maximum: DecimalText; unit: string | null; weight: DecimalText };
export type RuleSet = { id: string; code: string; version: number; mode: AbsenceMode; synthetic: boolean;
  validFrom: string; reference: string; inUse: boolean; items: RuleSetItem[] };
export type RuleCatalog = { ruleSets: RuleSet[] };

function invalid(): never { throw new DomainCommandError('invalid_input'); }
// Exact key sets: an unexpected field (a person, a raw value) is a contract break.
export function readExact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const r = readObject(value);
  if (Object.keys(r).length !== keys.length || keys.some(key => !(key in r))) return invalid();
  return r;
}
export function readBoolean(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
export function readOneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return allowed.includes(value as T) ? value as T : invalid();
}
function decimal(value: unknown): DecimalText { return readDecimal(value) ?? invalid(); }
// Aggregates rounded server-side to exactly two places; the sign is optional.
export function readFixed2(value: unknown, signed = false): string {
  const text = readText(value);
  if (!(signed ? /^-?(0|[1-9][0-9]*)\.[0-9]{2}$/ : /^(0|[1-9][0-9]*)\.[0-9]{2}$/).test(text) || text === '-0.00') return invalid();
  return text;
}
const nullable = <T,>(value: unknown, read: (v: unknown) => T): T | null => value === null ? null : read(value);
const directions = ['maior_melhor', 'menor_melhor'] as const;

function decodeItem(value: unknown): UnitResultItem {
  const r = readExact(value, ['indicatorCode', 'name', 'state', 'inputValue', 'meta', 'direction', 'weight', 'effectiveWeight', 'points', 'expression', 'reviewStatus']);
  const item: UnitResultItem = { indicatorCode: readText(r.indicatorCode), name: readText(r.name),
    state: readOneOf(r.state, ['valor', 'indisponivel', 'nao_aplicavel', 'pendente'] as const), inputValue: nullable(r.inputValue, decimal),
    meta: decimal(r.meta), direction: readOneOf(r.direction, directions), weight: decimal(r.weight),
    effectiveWeight: nullable(r.effectiveWeight, decimal), points: nullable(r.points, decimal), expression: nullable(r.expression, readText),
    reviewStatus: readOneOf(r.reviewStatus, ['valor', 'indisponivel', 'nao_aplicavel', 'sem_envio', 'em_conferencia', 'decisao_pendente'] as const) };
  // Only accepted values are exposed, always with their points and expression.
  const accepted = item.state === 'valor';
  if (accepted !== (item.inputValue !== null) || accepted !== (item.expression !== null) || (accepted && (item.points === null || item.effectiveWeight === null))
    || (item.state === 'pendente' && (item.points !== null || ['valor', 'indisponivel', 'nao_aplicavel'].includes(item.reviewStatus))) || (item.state !== 'pendente' && item.state !== item.reviewStatus)) return invalid();
  return item;
}

function decodeUnit(value: unknown): UnitResult {
  const r = readExact(value, ['unitId', 'unitCode', 'districtCode', 'points', 'complete', 'noBase', 'partial', 'previous', 'delta', 'items']);
  const previous = nullable(r.previous, v => { const p = readExact(v, ['points', 'competencia']); return { points: nullable(p.points, decimal), competencia: readText(p.competencia) }; });
  const unit: UnitResult = { unitId: readText(r.unitId), unitCode: readText(r.unitCode), districtCode: readText(r.districtCode),
    points: nullable(r.points, decimal), complete: readBoolean(r.complete), noBase: readBoolean(r.noBase), partial: readBoolean(r.partial),
    previous, delta: nullable(r.delta, v => readFixed2(v, true)), items: readArray(r.items, decodeItem) };
  if (unit.partial === unit.complete || unit.noBase !== (unit.points === null) || !unit.items.length
    || new Set(unit.items.map(i => i.indicatorCode)).size !== unit.items.length
    || (unit.delta !== null && (!unit.complete || unit.points === null || unit.previous === null || unit.previous.points === null))) return invalid();
  return unit;
}

export function decodeUnitResults(value: unknown): UnitResults {
  const r = readExact(value, ['competencia', 'state', 'publication', 'mode', 'units']);
  const results: UnitResults = { competencia: readText(r.competencia), state: readOneOf(r.state, ['aberta', 'em_consolidacao', 'fechada'] as const),
    publication: readOneOf(r.publication, ['nao_publicada', 'publicada_demo'] as const), mode: readOneOf(r.mode, absenceModes), units: readArray(r.units, decodeUnit) };
  if (!results.units.length || new Set(results.units.map(u => u.unitId)).size !== results.units.length
    || (results.publication === 'publicada_demo' && results.state !== 'fechada')) return invalid();
  return results;
}

export async function loadUnitResults(client: SupabaseClient, ctx: CommandContext): Promise<UnitResults> {
  return decodeUnitResults(await readRpc(client, 'get_unit_results', ctx));
}

export function readDate(value: unknown): string {
  const text = readText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text + 'T00:00:00Z')) || new Date(text + 'T00:00:00Z').toISOString().slice(0, 10) !== text) return invalid();
  return text;
}
function decodeRuleSetItem(value: unknown): RuleSetItem {
  const r = readExact(value, ['indicatorCode', 'name', 'meta', 'direction', 'decimals', 'maximum', 'unit', 'weight']);
  const decimals = readInteger(r.decimals);
  if (decimals > 4) return invalid();
  return { indicatorCode: readText(r.indicatorCode), name: readText(r.name), meta: decimal(r.meta), direction: readOneOf(r.direction, directions),
    decimals, maximum: decimal(r.maximum), unit: nullable(r.unit, readText), weight: decimal(r.weight) };
}
export function decodeRuleCatalog(value: unknown): RuleCatalog {
  const r = readExact(value, ['ruleSets']);
  return { ruleSets: readArray(r.ruleSets, v => {
    const s = readExact(v, ['id', 'code', 'version', 'mode', 'synthetic', 'validFrom', 'reference', 'inUse', 'items']);
    return { id: readText(s.id), code: readText(s.code), version: readInteger(s.version, 1), mode: readOneOf(s.mode, absenceModes),
      synthetic: readBoolean(s.synthetic), validFrom: readDate(s.validFrom), reference: readText(s.reference), inUse: readBoolean(s.inUse),
      items: readArray(s.items, decodeRuleSetItem) };
  }) };
}
