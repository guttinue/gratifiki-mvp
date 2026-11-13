import { expect, it } from "vitest";
import { competenceLabel, monthName, roleLabels, scopeName, scopeSummary } from "./displayNames";

it("names months, scopes and roles for presentation only", () => {
  expect(competenceLabel("ACADEMIC-V3-2026-10")).toBe("Outubro/2026");
  expect(competenceLabel("MONTH")).toBe("MONTH");
  expect(monthName("ACADEMIC-V3-2026-09")).toBe("setembro");
  expect(scopeSummary(["ACADEMIC-NORTE-1", "ACADEMIC-NORTE-2", "ACADEMIC-NORTE-1"])).toBe("Unidade Alfa e Unidade Beta");
  expect(scopeSummary(["ACADEMIC-NORTE-1", "ACADEMIC-NORTE-2", "ACADEMIC-SUL-1", "ACADEMIC-SUL-2"])).toBe("4 unidades");
  expect(scopeName("DEMO-T12-DISTRICT")).toBe("DEMO-T12-DISTRICT");
  expect(roleLabels.revisor_tecnico).toBe("Revisor técnico");
});
