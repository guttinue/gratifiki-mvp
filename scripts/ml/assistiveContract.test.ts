import { describe, expect, it } from 'vitest';
import { validateAssistiveRow, type AssistiveRow } from './assistiveContract.ts';

const row: AssistiveRow = {
  month: '2026-09', indicatorCode: 'DEMO-01', scopeCode: 'SYNTHETIC-A',
  ruleVersion: 1, unit: 'contagem', value: '0', dataState: 'valor',
};

describe('assistive synthetic row contract', () => {
  it('keeps zero and canonicalizes exact decimal text without mutating input', () => {
    const input = Object.freeze({ ...row, value: ' 00012,3400 ' });
    expect(validateAssistiveRow(input)).toEqual({ ...row, value: '12.34' });
    expect(input.value).toBe(' 00012,3400 ');
    expect(validateAssistiveRow(row).value).toBe('0');
  });

  it.each(['ausente', 'indisponivel', 'nao_aplicavel'] as const)('preserves %s as null, never zero', (dataState) => {
    expect(validateAssistiveRow({ ...row, dataState, value: null })).toEqual({ ...row, dataState, value: null });
    expect(() => validateAssistiveRow({ ...row, dataState, value: '0' })).toThrow('invalid_input');
  });

  it.each([
    null, [], {}, { ...row, unexpected: true }, { ...row, month: '2026-00' },
    { ...row, month: '2026-13' }, { ...row, month: '2026-9' }, { ...row, month: '0000-01' },
    { ...row, indicatorCode: '' }, { ...row, scopeCode: ' ' }, { ...row, unit: '' },
    { ...row, indicatorCode: 1 }, { ...row, ruleVersion: 0 }, { ...row, ruleVersion: 1.5 },
    { ...row, ruleVersion: Number.MAX_SAFE_INTEGER + 1 }, { ...row, ruleVersion: '1' },
    { ...row, value: null }, { ...row, value: 0 }, { ...row, value: '1e2' },
    { ...row, value: '-1' }, { ...row, value: '100000000' }, { ...row, value: '0.00001' },
    { ...row, value: 'NaN' }, { ...row, dataState: 'unknown' },
  ])('rejects malformed runtime input %#', (input) => {
    expect(() => validateAssistiveRow(input)).toThrow('invalid_input');
  });
});
