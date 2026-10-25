import { validateAssistiveRow, validateMonth, type AssistiveRow } from './assistiveContract.ts';
import type { DecimalText } from '../../src/features/pilot/types.ts';

function groupKey(row: AssistiveRow): string {
  return JSON.stringify([row.indicatorCode, row.scopeCode, row.unit, row.ruleVersion]);
}

function validatedRows(rows: AssistiveRow[], cutoff: string): AssistiveRow[] {
  validateMonth(cutoff);
  if (!Array.isArray(rows)) throw new Error('invalid_input');
  const normalized = Array.from(rows, validateAssistiveRow);
  const seen = new Set<string>();
  for (const row of normalized) {
    const key = JSON.stringify([row.month, groupKey(row)]);
    if (seen.has(key)) throw new Error('invalid_input');
    seen.add(key);
  }
  return normalized;
}

function partition(rows: AssistiveRow[], cutoff: string): {
  accepted: AssistiveRow[]; excluded: { row: AssistiveRow; reason: string }[];
} {
  const accepted: AssistiveRow[] = [];
  const excluded: { row: AssistiveRow; reason: string }[] = [];
  for (const row of rows) {
    if (row.month >= cutoff) excluded.push({ row, reason: 'not_before_cutoff' });
    else if (row.dataState !== 'valor') excluded.push({ row, reason: row.dataState });
    else accepted.push(row);
  }
  return { accepted, excluded };
}

/** Offline preparation only: cutoff is exclusive; separate groups stay separate. */
export function prepareAssistiveSeries(rows: AssistiveRow[], asOfMonth: string): {
  accepted: AssistiveRow[]; excluded: { row: AssistiveRow; reason: string }[];
} {
  return partition(validatedRows(rows, asOfMonth), asOfMonth);
}

/** Candidate descriptive reference, never a prediction or product decision. */
export function historicalMedian(rows: AssistiveRow[], beforeMonth: string): DecimalText | null {
  const normalized = validatedRows(rows, beforeMonth);
  if (new Set(normalized.map(groupKey)).size > 1) throw new Error('invalid_input');
  const values = partition(normalized, beforeMonth).accepted.map((row) => {
    const [whole, fraction = ''] = (row.value as DecimalText).split('.');
    return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  }).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  // Inputs have <=4 places. The exact mean of the middle pair needs <=5.
  // Number arithmetic is used only for array indices, never decimal values.
  const medianScaled5 = values.length % 2 === 1
    ? values[middle] * 10n
    : (values[middle - 1] + values[middle]) * 5n;
  const whole = medianScaled5 / 100000n;
  const fraction = (medianScaled5 % 100000n).toString().padStart(5, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
