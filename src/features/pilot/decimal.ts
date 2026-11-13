import type { DecimalText } from './types';
function parse(text:string, places:number, maximum:bigint, positive:boolean):DecimalText {
  const input=text.trim().replace(',','.');
  if (!/^\d+(?:\.\d+)?$/.test(input)) throw new Error('invalid_input');
  const [whole, fraction='']=input.split('.');
  if (fraction.length>places) throw new Error('invalid_input');
  const scaled=BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0'));
  if (scaled>maximum || (positive && scaled===0n)) throw new Error('invalid_input');
  const canonicalWhole=BigInt(whole).toString();
  const canonicalFraction=fraction.replace(/0+$/,'');
  return canonicalFraction ? `${canonicalWhole}.${canonicalFraction}` : canonicalWhole;
}
export function parseInputDecimal(text:string):DecimalText { return parse(text,4,999999999999n,false); }
export function parseFactor(text:string):DecimalText { return parse(text,6,1000000n,true); }
// Display only. Server decimals stay exact text; this adds the pt-BR comma and,
// when `places` is given, pads or rounds half away from zero (as numeric does).
export function formatDecimal(text:DecimalText, places?:number):string {
  const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error('invalid_input');
  const [, sign, whole, fraction='']=match;
  let digits=whole+fraction;
  let scale=fraction.length;
  if (places!==undefined && scale<places) { digits=digits.padEnd(digits.length+places-scale,'0'); scale=places; }
  else if (places!==undefined && scale>places) {
    const keep=digits.length-(scale-places);
    digits=(BigInt(digits.slice(0,keep)||'0')+(digits[keep]>='5'?1n:0n)).toString();
    scale=places;
  }
  digits=digits.padStart(scale+1,'0');
  const integer=digits.slice(0,digits.length-scale), decimals=digits.slice(digits.length-scale);
  return `${sign&&/[1-9]/.test(digits)?'-':''}${integer.replace(/^0+(?=\d)/,'')}${decimals?`,${decimals}`:''}`;
}
// Exact sum of decimal texts (up to 12 places), e.g. rule weights; display with formatDecimal.
export function sumDecimals(values:DecimalText[]):DecimalText {
  const scale=12n;
  const total=values.reduce((sum,value)=>{
    const match=/^(\d+)(?:\.(\d{1,12}))?$/.exec(value);
    if (!match) throw new Error('invalid_input');
    return sum+BigInt(match[1])*10n**scale+BigInt((match[2]??'').padEnd(12,'0'));
  },0n);
  const fraction=(total%10n**scale).toString().padStart(12,'0').replace(/0+$/,'');
  return `${total/10n**scale}${fraction?`.${fraction}`:''}`;
}
// Live preview of one indicator's points, mirroring private.calcular_pontos in the
// same order: ratio (↑ valor ÷ meta; ↓ meta ÷ valor, zero = 1, never above 1) rounded
// to 10 places, times the effective weight rounded to 10 places, then 2 places half up.
// BigInt only; the server stays the official calculation.
export type PreviewRule = { meta: DecimalText; direction: 'maior_melhor' | 'menor_melhor'; weight: DecimalText };
const PRECISION = 10;
function scaled(text: string): { digits: bigint; places: number } | null {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = match[2] ?? '';
  return { digits: BigInt(match[1] + fraction), places: fraction.length };
}
const divideRounded = (numerator: bigint, denominator: bigint) => (2n * numerator + denominator) / (2n * denominator);
const fromScaled = (digits: bigint, places: number): DecimalText => {
  const padded = digits.toString().padStart(places + 1, '0');
  const fraction = padded.slice(padded.length - places).replace(/0+$/, '');
  return `${padded.slice(0, padded.length - places)}${fraction ? `.${fraction}` : ''}`;
};
export function previewPoints(valueText: string, rule: PreviewRule): { points: DecimalText; expression: string } | null {
  const value = scaled(valueText), meta = scaled(rule.meta), weight = scaled(rule.weight);
  if (!value || !meta || !weight || meta.digits === 0n) return null;
  const shown = (x: { digits: bigint; places: number }) => formatDecimal(fromScaled(x.digits, x.places));
  const valueShown = shown(value), metaShown = shown(meta), weightShown = shown(weight);
  const up = rule.direction === 'maior_melhor';
  // numerator/denominator of the ratio as exact integers (same scale on both sides).
  const [numerator, denominator] = up
    ? [value.digits * 10n ** BigInt(meta.places), meta.digits * 10n ** BigInt(value.places)]
    : [meta.digits * 10n ** BigInt(value.places), value.digits * 10n ** BigInt(meta.places)];
  const zeroDescending = !up && value.digits === 0n;
  const ratio = zeroDescending || numerator >= denominator ? 10n ** BigInt(PRECISION) : divideRounded(numerator * 10n ** BigInt(PRECISION), denominator);
  // Effective weight at 10 places (it already has at most that many; this rounds a longer one).
  const effective = weight.places > PRECISION ? divideRounded(weight.digits, 10n ** BigInt(weight.places - PRECISION)) : weight.digits * 10n ** BigInt(PRECISION - weight.places);
  const exact = ratio * effective; // 20 places
  const points = divideRounded(exact, 10n ** BigInt(2 * PRECISION - 2));
  return { points: fromScaled(points, 2), expression: zeroDescending
    ? `valor zero no indicador descendente = peso integral (${weightShown})`
    : up ? `min(${valueShown} ÷ ${metaShown}; 1) × ${weightShown}` : `min(${metaShown} ÷ ${valueShown}; 1) × ${weightShown}` };
}
