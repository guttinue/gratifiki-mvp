import { describe, expectTypeOf, it } from "vitest";
import type { CommandContext, CommandReceipt, DraftInput, EvaluationItem, Role, PositionSummary } from "./types";

describe("academic boundary type contracts", () => {
  it("requires textual exact values and distinguishes unavailable from zero", () => {
    expectTypeOf<DraftInput["valor"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CommandReceipt["resultValue"]>().toEqualTypeOf<string | null>();
    expectTypeOf<PositionSummary["estadoDado"]>().toEqualTypeOf<"valor" | "indisponivel" | "nao_aplicavel" | null>();
  });
  it("does not let a command choose actor, role or scope", () => {
    expectTypeOf<keyof CommandContext>().toEqualTypeOf<"vinculoId" | "competenciaId" | "indicadorId">();
    expectTypeOf<Role>().toEqualTypeOf<"area_tecnica" | "revisor_tecnico" | "cam" | "gestor_unidade" | "gestor_distrital" | "administrador" | "lideranca">();
  });
  it("keeps restricted operational fields out of the evaluation projection", () => {
    expectTypeOf<Extract<keyof EvaluationItem, "actorId" | "autorId" | "fonte" | "motivo" | "audit">>().toEqualTypeOf<never>();
  });
});
