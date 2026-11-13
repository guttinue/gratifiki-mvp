import { describe, expect, it } from "vitest";
import type { AuthorizedContext } from "../pilot/types";
import { groupContexts, pickDefaultGroup } from "./contextGroups";

const base: AuthorizedContext = {
  key: "link:month:ind-1", actorId: "actor", role: "area_tecnica", vinculoId: "link", competenciaId: "month",
  competenciaCodigo: "2026-10", indicadorId: "ind-1", escopoId: "alfa", escopoCodigo: "ALFA", mode: "academic", modelo: 3,
};
const make = (over: Partial<AuthorizedContext>): AuthorizedContext => ({ ...base, ...over });

describe("groupContexts", () => {
  it("groups 4 indicators x 2 units of the same model-3 role and competence into 1 group of 8", () => {
    const contexts = ["alfa", "beta"].flatMap((unit) => [4, 3, 2, 1].map((n) => make({
      key: `${unit}-${n}`, vinculoId: `${unit}-${n}`, indicadorId: `ind-${n}`, escopoId: unit, escopoCodigo: unit.toUpperCase(),
    })));
    const groups = groupContexts(contexts);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "area_tecnica:month", modelo: 3, role: "area_tecnica", competenciaId: "month", competenciaCodigo: "2026-10" });
    expect(groups[0].contexts).toHaveLength(8);
  });

  it("groups one model-3 role and month across units, ordered by scope then indicator", () => {
    const contexts = ["beta", "alfa"].flatMap((u) => [2, 1].map((n) => make({ key: `${u}-${n}`, vinculoId: `${u}-${n}`, indicadorId: `ind-${n}`, escopoId: u, escopoCodigo: u.toUpperCase() })));
    const [group, ...rest] = groupContexts(contexts);
    expect(rest).toEqual([]);
    expect(group.key).toBe("area_tecnica:month");
    expect(group.contexts.map((c) => `${c.escopoCodigo}/${c.indicadorId}`)).toEqual(["ALFA/ind-1", "ALFA/ind-2", "BETA/ind-1", "BETA/ind-2"]);
    expect(group).toMatchObject({ escopoId: "alfa", escopoCodigo: "ALFA", modelo: 3 });
  });

  it("keeps model 2 grouped by scope", () => {
    const groups = groupContexts(["alfa", "beta"].map((u) => make({ key: u, vinculoId: u, escopoId: u, escopoCodigo: u.toUpperCase(), modelo: 2 })));
    expect(groups.map((g) => g.key)).toEqual(["area_tecnica:month:alfa", "area_tecnica:month:beta"]);
  });

  it("turns one model 2 context into one group carrying modelo 2", () => {
    const groups = groupContexts([make({ modelo: 2 })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "area_tecnica:month:alfa", modelo: 2, escopoCodigo: "ALFA" });
    expect(groups[0].contexts).toEqual([make({ modelo: 2 })]);
  });

  it("orders groups by competence code descending, then role, then scope code", () => {
    const groups = groupContexts([
      make({ key: "a", competenciaId: "sep", competenciaCodigo: "2026-09", role: "cam", escopoId: "z", escopoCodigo: "Z", modelo: 2 }),
      make({ key: "b", role: "revisor_tecnico", escopoId: "a", escopoCodigo: "A", modelo: 2 }),
      make({ key: "c", role: "cam", escopoId: "b", escopoCodigo: "B", modelo: 2 }),
      make({ key: "d", role: "cam", escopoId: "a", escopoCodigo: "A", modelo: 2 }),
    ]);
    expect(groups.map(({ competenciaCodigo, role, escopoCodigo }) => `${competenciaCodigo}/${role}/${escopoCodigo}`)).toEqual([
      "2026-10/cam/A", "2026-10/cam/B", "2026-10/revisor_tecnico/A", "2026-09/cam/Z",
    ]);
  });

  it("returns no group for no context", () => {
    expect(groupContexts([])).toEqual([]);
  });
});

describe("pickDefaultGroup", () => {
  const one = (over: Partial<AuthorizedContext>) => groupContexts([make(over)])[0];
  const sep = one({ key: "s", competenciaId: "sep", competenciaCodigo: "ACADEMIC-V3-2026-09", competenciaEstado: "aberta" });
  const oct = one({ key: "o", competenciaId: "oct", competenciaCodigo: "ACADEMIC-V3-2026-10", competenciaEstado: "fechada" });
  const m2 = one({ key: "m", competenciaId: "nov", competenciaCodigo: "ACADEMIC-2026-11", modelo: 2 });
  it("opens the latest open model-3 month, never a model-2 one", () => expect(pickDefaultGroup([m2, oct, sep])?.key).toBe(sep.key));
  it("falls back to the latest model-3 month when none is open", () => expect(pickDefaultGroup([m2, oct, { ...sep, contexts: [{ ...sep.contexts[0], competenciaEstado: "fechada" }] }])?.key).toBe(oct.key));
  it("breaks a tie between roles by the academic role order", () => {
    const cam = one({ key: "c", role: "cam", competenciaEstado: "aberta" }), rev = one({ key: "r", role: "revisor_tecnico", competenciaEstado: "aberta" });
    expect(pickDefaultGroup([cam, rev])?.role).toBe("revisor_tecnico");
  });
  it("without model 3 keeps today rule: the only group, or none", () => {
    expect(pickDefaultGroup([m2])).toBe(m2);
    expect(pickDefaultGroup([m2, one({ key: "x", escopoId: "b", escopoCodigo: "B", modelo: 2 })])).toBeNull();
  });
});
