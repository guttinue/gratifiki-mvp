import { describe, expect, it } from 'vitest';
import { formatDecimal, parseFactor, parseInputDecimal, previewPoints, sumDecimals } from './decimal';

describe('exact academic decimal input', () => {
  it.each([['0','0'],['0,0001','0.0001'],[' 00010.0800 ','10.08'],['99999999.9999','99999999.9999']])('normalizes %s without floating point', (input,want) => expect(parseInputDecimal(input)).toBe(want));
  it.each(['','-1','1.234,56','100000000','1e2','Infinity','0.00001','1,2,3','.1','1.'])('rejects invalid input %s', input => expect(() => parseInputDecimal(input)).toThrow('invalid_input'));
  it.each([['1','1'],['0,000001','0.000001'],['0.800000','0.8']])('normalizes factor %s', (input,want) => expect(parseFactor(input)).toBe(want));
  it.each(['0','1.000001','0.0000001','-0.1','1e-1'])('rejects invalid factor %s', input => expect(() => parseFactor(input)).toThrow('invalid_input'));
});

describe('decimal display', () => {
  it.each([['93.42',2,'93,42'],['20',2,'20,00'],['4.8',2,'4,80'],['-17.97',2,'-17,97'],['0',2,'0,00'],['0.005',2,'0,01'],['0.004',2,'0,00'],
    ['99.999',2,'100,00'],['-0.004',2,'0,00'],['12.5',undefined,'12,5'],['48',undefined,'48'],['8760',0,'8760'],['2.5',0,'3']] as const)('formats %s with %s places as %s', (input, places, want) =>
    expect(formatDecimal(input, places)).toBe(want));
  it.each(['', '1,5', 'abc', '1e2', ' 1'])('rejects %s', input => expect(() => formatDecimal(input, 2)).toThrow('invalid_input'));
});

describe('exact decimal sum', () => {
  it.each([[['30','25','25','20'],'100'],[['33.3333333333','33.3333333333','33.3333333334'],'100'],[['0.1','0.2'],'0.3'],[[],'0']] as const)('adds %j to %s', (input, want) =>
    expect(sumDecimals([...input])).toBe(want));
  it.each(['-1', '1.1234567890123', 'x'])('rejects %s', input => expect(() => sumDecimals([input])).toThrow('invalid_input'));
});

// Mirrors private.calcular_pontos: ratio rounded to 10 places, times the weight, then 2 places half up.
describe('points preview', () => {
  const up = { meta: '95', direction: 'maior_melhor', weight: '30' } as const;
  const down = { meta: '48', direction: 'menor_melhor', weight: '25' } as const;
  it.each([
    [up, '88', '27.79'], [up, '90', '28.42'], [up, '95', '30'], [up, '120', '30'], [up, '0', '0'],
    [down, '0', '25'], [down, '60', '20'], [down, '52', '23.08'], [down, '48', '25'], [down, '30', '25'],
  ] as const)('scores %j with value %s as %s', (rule, value, want) => expect(previewPoints(value, rule)?.points).toBe(want));
  it('rounds the ratio to 10 places before multiplying (the order of the server)', () => {
    // 1/3 -> 0.3333333333; x 0.015 = 0.0049999999995 -> 0.00 (an exact 0.005 would round up to 0.01).
    expect(previewPoints('1', { meta: '3', direction: 'maior_melhor', weight: '0.015' })?.points).toBe('0');
    // 0.00005 x 100 = 0.005 exactly -> half up -> 0.01
    expect(previewPoints('1', { meta: '20000', direction: 'maior_melhor', weight: '100' })?.points).toBe('0.01');
  });
  it('accepts a comma and trailing zeros and explains the calculation like the server', () => {
    expect(previewPoints('90,0', up)).toEqual({ points: '28.42', expression: 'min(90 ÷ 95; 1) × 30' });
    expect(previewPoints('52', down)?.expression).toBe('min(48 ÷ 52; 1) × 25');
    expect(previewPoints('0', down)?.expression).toBe('valor zero no indicador descendente = peso integral (25)');
  });
  it.each(['', 'abc', '-1', '1,2,3'])('has no preview for %j', value => expect(previewPoints(value, up)).toBeNull());
  it('has no preview without a positive meta', () => expect(previewPoints('1', { ...up, meta: '0' })).toBeNull());
});
