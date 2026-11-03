import { parseInputDecimal } from "../pilot/decimal";
import type { DecimalText } from "../pilot/types";

const INVALID_VALUE_MESSAGE =
  "Informe um número entre 0 e 99999999.9999, com ponto e até quatro casas decimais.";
const DEMO_VALUE_PATTERN = /^[0-9]+(?:\.[0-9]{1,4})?$/;

export function validateDemoValue(valueText: string): string | null {
  const candidate = valueText.replace(/^ +| +$/g, "");
  if (!DEMO_VALUE_PATTERN.test(candidate)) return INVALID_VALUE_MESSAGE;

  const integerPart = candidate.split(".", 1)[0] ?? "";
  const significantInteger = integerPart.replace(/^0+/, "") || "0";
  if (significantInteger.length > 8) return INVALID_VALUE_MESSAGE;

  return null;
}

export type RuleValueLimits = { decimals: number; max: DecimalText };
export type RuleValueCheck = { ok: true; value: DecimalText } | { ok: false; message: string };

// Exact BigInt comparison of two canonical decimal texts (no Number/float).
function compareDecimal(left: DecimalText, right: DecimalText): number {
  const [leftWhole, leftFraction = ""] = left.split(".");
  const [rightWhole, rightFraction = ""] = right.split(".");
  const places = Math.max(leftFraction.length, rightFraction.length);
  const scaled = (whole: string, fraction: string) => BigInt(whole + fraction.padEnd(places, "0"));
  const difference = scaled(leftWhole, leftFraction) - scaled(rightWhole, rightFraction);
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}

function formatMaximum(max: DecimalText): string {
  const [whole, fraction] = max.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return fraction ? `${grouped},${fraction}` : grouped;
}

// Client-side check of a meta/weight value with the V3 messages. The server
// repeats every check; this only explains the problem before sending.
export function validateRuleValue(text: string, rule: RuleValueLimits): RuleValueCheck {
  const candidate = text.trim();
  if (!candidate) return { ok: false, message: "Informe o valor." };
  if (!/^\d+(?:[.,]\d+)?$/.test(candidate)) return { ok: false, message: "Use só números, com vírgula para decimais." };
  const places = (candidate.split(/[.,]/)[1] ?? "").length;
  if (places > rule.decimals) {
    return { ok: false, message: rule.decimals ? `Use no máximo ${rule.decimals} casas decimais.` : "Informe um número inteiro." };
  }
  const max = parseInputDecimal(rule.max);
  const above = { ok: false, message: `O valor máximo é ${formatMaximum(max)}.` } as const;
  let value: DecimalText;
  // The grammar and places already passed, so a parse failure is a value too large.
  try { value = parseInputDecimal(candidate); } catch { return above; }
  return compareDecimal(value, max) > 0 ? above : { ok: true, value };
}
