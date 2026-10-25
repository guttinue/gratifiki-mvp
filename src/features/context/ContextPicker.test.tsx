import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContextPicker } from "./ContextPicker";
import type { AuthorizedContext } from "../pilot/types";

const first: AuthorizedContext = {
  key: "one", actorId: "actor", role: "cam", vinculoId: "one", competenciaId: "month",
  competenciaCodigo: "MONTH", indicadorId: "indicator", escopoId: "unit", escopoCodigo: "UNIT", mode: "academic",
};
afterEach(cleanup);

it("offers only backend choices and passes their key, not a free role", () => {
  const onSelect = vi.fn();
  render(<ContextPicker contexts={[first, { ...first, key: "two", vinculoId: "two", role: "revisor_tecnico" }]} selectedKey={null} onSelect={onSelect} />);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(screen.queryByRole("option", { name: /administrador/ })).toBeNull();
  fireEvent.change(screen.getByLabelText("Contexto autorizado"), { target: { value: "two" } });
  expect(onSelect).toHaveBeenCalledWith("two");
});
