import { describe, expect, it } from "vitest";
import type { PilotContext } from "./types";

describe("PilotContext", () => {
  it("requires the signed-in actor, agreed role, and scope", () => {
    const context: PilotContext = {
      actorId: "actor-demo",
      papel: "area_tecnica",
      competenciaId: "competencia-demo",
      competenciaCodigo: "DEMO-2026-09",
      referencia: "2026-09-15",
      indicadorId: "indicador-demo",
      indicadorCodigo: "DEMO-01",
      escopoId: "escopo-demo",
      escopoCodigo: "DEMO-ESCOPO-01",
    };

    expect(context.papel).toBe("area_tecnica");
    expect(context.actorId).toBe("actor-demo");
    expect(context.escopoId).toBe("escopo-demo");
  });
});
