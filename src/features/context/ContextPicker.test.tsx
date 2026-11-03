import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextPicker } from "./ContextPicker";
import { groupContexts } from "./contextGroups";
import type { AuthorizedContext } from "../pilot/types";

const first: AuthorizedContext = {
  key: "one", actorId: "actor", role: "cam", vinculoId: "one", competenciaId: "month",
  competenciaCodigo: "MONTH", indicadorId: "indicator", escopoId: "unit", escopoCodigo: "UNIT", mode: "academic", modelo: 2,
};
afterEach(cleanup);

it("offers only backend groups and passes the group key, not a free role", () => {
  const onSelect = vi.fn();
  const groups = groupContexts([first, { ...first, key: "two", vinculoId: "two", role: "revisor_tecnico" }]);
  render(<ContextPicker groups={groups} selectedKey={null} onSelect={onSelect} />);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(screen.queryByRole("option", { name: /administrador/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Contexto autorizado"), { target: { value: "revisor_tecnico:month:unit" } });
  expect(onSelect).toHaveBeenCalledWith("revisor_tecnico:month:unit");
});

it("lists one option per group, however many indicators the group holds", () => {
  const four = [1, 2, 3, 4].map((n) => ({ ...first, key: `k${n}`, vinculoId: `k${n}`, indicadorId: `i${n}`, modelo: 3 as const }));
  render(<ContextPicker groups={groupContexts(four)} selectedKey="cam:month" onSelect={vi.fn()} />);
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Selecione um contexto", "CAM · MONTH",
  ]);
});

it("labels model-3 options by name and splits model kinds into optgroups", () => {
  const groups = groupContexts([
    { ...first, key: "m3", vinculoId: "m3", role: "area_tecnica", competenciaId: "oct", competenciaCodigo: "ACADEMIC-V3-2026-10", modelo: 3, competenciaEstado: "aberta" },
    first,
  ]);
  render(<ContextPicker groups={groups} selectedKey={null} onSelect={vi.fn()} />);
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
    "Selecione um contexto", "Área técnica · Outubro/2026 · Aberta", "cam · UNIT · MONTH · acadêmico",
  ]);
  expect(screen.getAllByRole("group").map((group) => group.getAttribute("label"))).toEqual(["Gratifiki · regra DEMO-v1", "Baseline legada"]);
});
