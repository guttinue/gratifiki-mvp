import { describe, expect, it } from 'vitest';
import { parseFactor, parseInputDecimal } from './decimal';

describe('exact academic decimal input', () => {
  it.each([['0','0'],['0,0001','0.0001'],[' 00010.0800 ','10.08'],['99999999.9999','99999999.9999']])('normalizes %s without floating point', (input,want) => expect(parseInputDecimal(input)).toBe(want));
  it.each(['','-1','1.234,56','100000000','1e2','Infinity','0.00001','1,2,3','.1','1.'])('rejects invalid input %s', input => expect(() => parseInputDecimal(input)).toThrow('invalid_input'));
  it.each([['1','1'],['0,000001','0.000001'],['0.800000','0.8']])('normalizes factor %s', (input,want) => expect(parseFactor(input)).toBe(want));
  it.each(['0','1.000001','0.0000001','-0.1','1e-1'])('rejects invalid factor %s', input => expect(() => parseFactor(input)).toThrow('invalid_input'));
});
