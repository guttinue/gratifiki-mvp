import { describe, expect, it } from "vitest";
import { validateDemoValue } from "./valueValidation";

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
