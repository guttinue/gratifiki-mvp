import type { DecimalText } from '../../src/features/pilot/types.ts';
import { parseInputDecimal } from '../../src/features/pilot/decimal.ts';

export interface AssistiveRow {
  month: string;
  indicatorCode: string;
  scopeCode: string;
  ruleVersion: number;
  unit: string;
  value: DecimalText | null;
  dataState: 'valor' | 'ausente' | 'indisponivel' | 'nao_aplicavel';
}

const keys = ['month', 'indicatorCode', 'scopeCode', 'ruleVersion', 'unit', 'value', 'dataState'];

export function validateMonth(input: unknown): asserts input is string {
  if (typeof input !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(input)) {
    throw new Error('invalid_input');
  }
}

/** Runtime boundary: reject malformed rows; return a fresh normalized copy. */
export function validateAssistiveRow(input: unknown): AssistiveRow {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid_input');
  const row = input as Record<string, unknown>;
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) {
    throw new Error('invalid_input');
  }
  validateMonth(row.month);
  for (const key of ['indicatorCode', 'scopeCode', 'unit']) {
    if (typeof row[key] !== 'string' || row[key].trim().length === 0) throw new Error('invalid_input');
  }
  if (typeof row.ruleVersion !== 'number' || !Number.isSafeInteger(row.ruleVersion) || row.ruleVersion < 1) {
    throw new Error('invalid_input');
  }
  if (!['valor', 'ausente', 'indisponivel', 'nao_aplicavel'].includes(row.dataState as string)) {
    throw new Error('invalid_input');
  }
  if (row.dataState === 'valor' ? typeof row.value !== 'string' : row.value !== null) {
    throw new Error('invalid_input');
  }
  return {
    month: row.month,
    indicatorCode: row.indicatorCode as string,
    scopeCode: row.scopeCode as string,
    ruleVersion: row.ruleVersion,
    unit: row.unit as string,
    value: row.dataState === 'valor' ? parseInputDecimal(row.value as string) : null,
    dataState: row.dataState as AssistiveRow['dataState'],
  };
}
