import { describe, expect, it } from "vitest";
import { validateDemoValue, validateRuleValue } from "./valueValidation";

describe("validateDemoValue", () => {
  it.each(["0", "10", "0.0001", "99999999.9999", "00010.1200", " 10 "])(
    "accepts the supported decimal representation %j",
    (value) => {
      expect(validateDemoValue(value)).toBeNull();
    },
  );

  it.each([
    "",
    "   ",
    "-1",
    "-0",
    "abc",
    "NaN",
    "Infinity",
    "+1",
    ".5",
    "1.",
    "1e2",
    "1,5",
    "0.00001",
    "100000000",
    "\t10",
    "10\n",
  ])("rejects a value outside the supported decimal grammar: %j", (value) => {
    expect(validateDemoValue(value)).toEqual(expect.any(String));
  });
});

describe("validateRuleValue", () => {
  it.each([
    ["90", { decimals: 2, max: "100" }, "90"],
    ["90,5", { decimals: 2, max: "100" }, "90.5"],
    ["100", { decimals: 2, max: "100" }, "100"],
    ["0", { decimals: 0, max: "1000" }, "0"],
    [" 48,00 ", { decimals: 2, max: "8760" }, "48"],
  ])("accepts %j within the rule as exact decimal text", (text, rule, value) => {
    expect(validateRuleValue(text, rule)).toEqual({ ok: true, value });
  });

  it.each([
    ["90,123", { decimals: 2, max: "100" }, "Use no máximo 2 casas decimais."],
    ["100,01", { decimals: 2, max: "100" }, "O valor máximo é 100."],
    ["8760,01", { decimals: 2, max: "8760" }, "O valor máximo é 8.760."],
    ["20,5", { decimals: 0, max: "1000" }, "Informe um número inteiro."],
    ["", { decimals: 2, max: "100" }, "Informe o valor."],
    ["-1", { decimals: 2, max: "100" }, "Use só números, com vírgula para decimais."],
    ["1.234,5", { decimals: 2, max: "100" }, "Use só números, com vírgula para decimais."],
    ["1e2", { decimals: 2, max: "100" }, "Use só números, com vírgula para decimais."],
  ])("rejects %j with the V3 message", (text, rule, message) => {
    expect(validateRuleValue(text, rule)).toEqual({ ok: false, message });
  });
});
