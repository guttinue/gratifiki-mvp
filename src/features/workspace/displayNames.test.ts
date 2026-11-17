import { expect, it } from "vitest";
import { auditActions, auditCategories, blockerReasons, competenceLabel, countByStatus, monthName, roleLabels, scopeName, scopeSummary, stateTones, statusTones } from "./displayNames";
import type { EntryStatus, PositionSummary } from "../pilot/types";

it("names months, scopes and roles for presentation only", () => {
  expect(competenceLabel("ACADEMIC-V3-2026-10")).toBe("Outubro/2026");
  expect(competenceLabel("MONTH")).toBe("MONTH");
  expect(monthName("ACADEMIC-V3-2026-09")).toBe("setembro");
  expect(scopeSummary(["ACADEMIC-NORTE-1", "ACADEMIC-NORTE-2", "ACADEMIC-NORTE-1"])).toBe("Unidade Alfa e Unidade Beta");
  expect(scopeSummary(["ACADEMIC-NORTE-1", "ACADEMIC-NORTE-2", "ACADEMIC-SUL-1", "ACADEMIC-SUL-2"])).toBe("4 unidades");
  expect(scopeName("DEMO-T12-DISTRICT")).toBe("DEMO-T12-DISTRICT");
  expect(roleLabels.revisor_tecnico).toBe("Revisor técnico");
});

it("tones, blocker reasons and audit categories follow the V4", () => {
  expect(statusTones.em_revisao).toBe("vio");
  expect(stateTones.fechada).toBe("vio");
  expect(blockerReasons.devolvida).toBe("Devolvida, aguardando correção");
  const seen = auditCategories.flatMap((c) => c.actions ?? []);
  expect(new Set(seen).size).toBe(seen.length);
  expect(seen.every((a) => a in auditActions)).toBe(true);
  expect(auditCategories.find((c) => c.id === "exportacao")?.actions).toContain("snapshot_exportado_demo");
  const row = (status: EntryStatus | "ausente") => ({ position: { status } as PositionSummary });
  expect(countByStatus([row("validada"), row("validada"), row("devolvida")])).toMatchObject({ validada: 2, devolvida: 1, total: 3, rascunho: 0 });
});
