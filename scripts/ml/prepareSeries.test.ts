import { describe, expect, it } from 'vitest';
import type { AssistiveRow } from './assistiveContract.ts';
import { historicalMedian, prepareAssistiveSeries } from './prepareSeries.ts';

function row(month: string, value: string | null, patch: Partial<AssistiveRow> = {}): AssistiveRow {
  return { month, value, indicatorCode: 'DEMO-01', scopeCode: 'SYNTHETIC-A', ruleVersion: 1,
    unit: 'contagem', dataState: value === null ? 'ausente' : 'valor', ...patch };
}

describe('strict temporal preparation', () => {
  it('keeps prior zero, excludes target/future before considering state, preserves order', () => {
    const rows = [row('2026-09', '0'), row('2026-10', '100'), row('2026-11', null),
      row('2026-08', null), row('2026-07', null, { dataState: 'indisponivel' }),
      row('2026-06', null, { dataState: 'nao_aplicavel' }), row('2026-05', '12')];
    expect(prepareAssistiveSeries(rows, '2026-10')).toEqual({
      accepted: [rows[0], rows[6]], excluded: [
        { row: rows[1], reason: 'not_before_cutoff' }, { row: rows[2], reason: 'not_before_cutoff' },
        { row: rows[3], reason: 'ausente' }, { row: rows[4], reason: 'indisponivel' },
        { row: rows[5], reason: 'nao_aplicavel' },
      ],
    });
  });

  it('preserves distinct versions and groups without aggregating or conflating them', () => {
    const rows = [row('2026-09', '0'), row('2026-09', '1', { ruleVersion: 2 }),
      row('2026-09', '2', { scopeCode: 'SYNTHETIC-B' }), row('2026-09', '3', { unit: 'percentual' }),
      row('2026-09', '4', { indicatorCode: 'OTHER-SYNTHETIC' })];
    expect(prepareAssistiveSeries(rows, '2026-10')).toEqual({ accepted: rows, excluded: [] });
  });

  it('does not mutate input and does not return mutable aliases, including excluded rows', () => {
    const rows = [Object.freeze(row('2026-09', '0012.3400')), Object.freeze(row('2026-10', '100'))];
    const before = JSON.stringify(rows);
    const prepared = prepareAssistiveSeries(rows, '2026-10');
    prepared.accepted[0].scopeCode = 'CHANGED';
    prepared.excluded[0].row.value = '999';
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe('candidate historical median, not a prediction', () => {
  it('returns 11 for the pedagogic 10/12/11 history, excluding target 100 and future', () => {
    expect(historicalMedian([row('2026-07', '10'), row('2026-08', '12'), row('2026-09', '11'),
      row('2026-10', '100'), row('2026-11', '999')], '2026-10')).toBe('11');
  });

  it.each([
    [['0', '0.0001'], '0.00005'], [['0.1', '0.2'], '0.15'],
    [['99999999.9998', '99999999.9999'], '99999999.99985'],
    [['12', '2', '9'], '9'], [['0', '0', '9'], '0'], [['1.2300'], '1.23'],
    [['0.3', '0.1', '0.2', '0.4'], '0.25'],
  ])('calculates an exact decimal median for %j', (values, expected) => {
    const rows = (values as string[]).map((value, index) => row(`2026-0${index + 1}`, value));
    expect(historicalMedian(rows, '2026-10')).toBe(expected);
  });

  it('does not impute missing states and returns null with no comparable history', () => {
    expect(historicalMedian([], '2026-10')).toBeNull();
    expect(historicalMedian([row('2026-09', null), row('2026-10', '100')], '2026-10')).toBeNull();
    expect(historicalMedian([row('2026-08', null), row('2026-09', '10')], '2026-10')).toBe('10');
  });

  it.each(['indicatorCode', 'scopeCode', 'unit', 'ruleVersion'] as const)(
    'rejects mixed %s even when the incompatible row is future or unavailable', (field) => {
      const patch = { [field]: field === 'ruleVersion' ? 2 : 'OTHER' };
      expect(() => historicalMedian([row('2026-09', '10'), row('2026-11', null, patch)], '2026-10'))
        .toThrow('invalid_input');
    },
  );

  it('leaves input ordering, values and all row objects untouched', () => {
    const rows = [Object.freeze(row('2026-07', '12')), Object.freeze(row('2026-08', '2')),
      Object.freeze(row('2026-09', '9'))];
    const before = JSON.stringify(rows);
    expect(historicalMedian(rows, '2026-10')).toBe('9');
    expect(JSON.stringify(rows)).toBe(before);
  });
});

describe.each([prepareAssistiveSeries, historicalMedian])('whole-input validation for %s', (prepare) => {
  it.each(['2026-00', '2026-13', '2026-1', '0000-01', '', null, 202610])('rejects invalid cutoff %j', (cutoff) => {
    expect(() => prepare([], cutoff as string)).toThrow('invalid_input');
  });

  it('rejects a malformed future value instead of silently filtering it away', () => {
    expect(() => prepare([row('2026-09', '1'), row('2026-11', 'NaN')], '2026-10')).toThrow('invalid_input');
  });

  it('rejects a non-array runtime input', () => {
    expect(() => prepare(null as unknown as AssistiveRow[], '2026-10')).toThrow('invalid_input');
  });

  it('rejects duplicate observation keys even if values/states differ or are future', () => {
    expect(() => prepare([row('2026-09', '1'), row('2026-09', '2')], '2026-10')).toThrow('invalid_input');
    expect(() => prepare([row('2026-11', null), row('2026-11', '2')], '2026-10')).toThrow('invalid_input');
  });
});
