import { describe, expect, it } from "vitest";
import type { AuthorizedContext } from "../pilot/types";
import { groupContexts } from "./contextGroups";

const base: AuthorizedContext = {
  key: "link:month:ind-1", actorId: "actor", role: "area_tecnica", vinculoId: "link", competenciaId: "month",
  competenciaCodigo: "2026-10", indicadorId: "ind-1", escopoId: "alfa", escopoCodigo: "ALFA", mode: "academic", modelo: 3,
};
const make = (over: Partial<AuthorizedContext>): AuthorizedContext => ({ ...base, ...over });

describe("groupContexts", () => {
  it("groups 4 indicators x 2 units of the same role and competence into 2 groups of 4", () => {
    const contexts = ["alfa", "beta"].flatMap((unit) => [4, 3, 2, 1].map((n) => make({
      key: `${unit}-${n}`, vinculoId: `${unit}-${n}`, indicadorId: `ind-${n}`, escopoId: unit, escopoCodigo: unit.toUpperCase(),
    })));
    const groups = groupContexts(contexts);
    expect(groups).toHaveLength(2);
    expect(groups.map(({ key }) => key)).toEqual(["area_tecnica:month:alfa", "area_tecnica:month:beta"]);
    for (const group of groups) {
      expect(group.contexts).toHaveLength(4);
      expect(group.contexts.map(({ indicadorId }) => indicadorId)).toEqual(["ind-1", "ind-2", "ind-3", "ind-4"]);
      expect(group.modelo).toBe(3);
      expect(group).toMatchObject({ role: "area_tecnica", competenciaId: "month", competenciaCodigo: "2026-10" });
    }
    expect(groups[1]).toMatchObject({ escopoId: "beta", escopoCodigo: "BETA" });
  });

  it("turns one model 2 context into one group carrying modelo 2", () => {
    const groups = groupContexts([make({ modelo: 2 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "area_tecnica:month:alfa", modelo: 2, escopoCodigo: "ALFA" });
    expect(groups[0].contexts).toEqual([make({ modelo: 2 })]);
  });

  it("orders groups by competence code descending, then role, then scope code", () => {
    const groups = groupContexts([
      make({ key: "a", competenciaId: "sep", competenciaCodigo: "2026-09", role: "cam", escopoId: "z", escopoCodigo: "Z" }),
      make({ key: "b", role: "revisor_tecnico", escopoId: "a", escopoCodigo: "A" }),
      make({ key: "c", role: "cam", escopoId: "b", escopoCodigo: "B" }),
      make({ key: "d", role: "cam", escopoId: "a", escopoCodigo: "A" }),
    ]);
    expect(groups.map(({ competenciaCodigo, role, escopoCodigo }) => `${competenciaCodigo}/${role}/${escopoCodigo}`)).toEqual([
      "2026-10/cam/A", "2026-10/cam/B", "2026-10/revisor_tecnico/A", "2026-09/cam/Z",
    ]);
  });

  it("returns no group for no context", () => {
    expect(groupContexts([])).toEqual([]);
  });
});
