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
