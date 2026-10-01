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
