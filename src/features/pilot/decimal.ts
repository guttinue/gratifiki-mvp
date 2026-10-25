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
