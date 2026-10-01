import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { camContext, pilotEntries, technicalContext } from "./workspaceTestFixtures";
import { EntriesPage } from "./EntriesPage";

afterEach(cleanup);

describe("EntriesPage", () => {
  it("filters visible persisted rows by text and state and preserves the exact pending result", () => {
    render(
      <EntriesPage
        context={technicalContext}
        entries={pilotEntries}
        entryForm={<form aria-label="Entrada técnica"><label>Valor para o indicador<input /></label></form>}
        errorMessage={null}
        isLoading={false}
        onRetry={vi.fn()}
        onSelectEntry={vi.fn()}
        selectedEntryId={null}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar por identificador ou valor" }), {
      target: { value: "00010.1200" },
    });
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "pendente" } });

    expect(screen.getByRole("row", { name: /entry-001/i })).toBeTruthy();
    expect(screen.queryByRole("row", { name: /entry-003/i })).toBeNull();
    expect(screen.getByText("8.096000")).toBeTruthy();
    expect(within(screen.getByRole("row", { name: /entry-001/i })).getByText("Pendente")).toBeTruthy();
  });

  it("keeps CAM read-only without an entry form or business commands", () => {
    render(
      <EntriesPage
        context={camContext}
        entries={pilotEntries}
        errorMessage={null}
        isLoading={false}
        onRetry={vi.fn()}
        onSelectEntry={vi.fn()}
        selectedEntryId={null}
      />,
    );

    expect(screen.getByText(/perfil CAM.*somente leitura/i)).toBeTruthy();
    expect(screen.queryByLabelText("Valor para o indicador")).toBeNull();
    expect(screen.queryByRole("button", { name: /aprovar|devolver|corrigir|fechar|exportar/i })).toBeNull();
  });

  it("does not show a selected detail while that entry is filtered out", () => {
    render(
      <EntriesPage
        context={technicalContext}
        entries={pilotEntries}
        errorMessage={null}
        isLoading={false}
        onRetry={vi.fn()}
        onSelectEntry={vi.fn()}
        selectedEntryId="entry-001"
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar por identificador ou valor" }), {
      target: { value: "entry-003" },
    });

    expect(screen.getByRole("row", { name: /entry-003/i })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /detalhe da entrada entry-001/i })).toBeNull();
  });
});
