import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pilotEntries } from "./workspaceTestFixtures";
import { HistoryPage } from "./HistoryPage";

afterEach(cleanup);

describe("HistoryPage", () => {
  it("shows persisted events and the stored calculation memory in an accessible detail", () => {
    function HistoryHarness() {
      const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
      return (
        <HistoryPage
          entries={pilotEntries}
          errorMessage={null}
          isLoading={false}
          onRetry={vi.fn()}
          onSelectEntry={setSelectedEntryId}
          selectedEntryId={selectedEntryId}
        />
      );
    }

    render(<HistoryHarness />);

    expect(screen.getByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeTruthy();
    expect(screen.getByRole("row", { name: /entrada enviada.*entry-001/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ver detalhe.*entry-001/i }));

    const detail = screen.getByRole("region", { name: /detalhe da entrada entry-001/i });
    expect(document.activeElement).toBe(detail);
    expect(within(detail).getAllByText("00010.1200")).toHaveLength(2);
    expect(within(detail).getByText("8.096000")).toBeTruthy();
    expect(within(detail).getByText("rule-demo-02")).toBeTruthy();
    expect(within(detail).getByText("0.800000")).toBeTruthy();
    expect(within(detail).getAllByText("operation-001")).toHaveLength(2);
    expect(within(detail).getByText("demo.entry.submitted")).toBeTruthy();
  });

  it("states that the context has no events when entries exist without audit events", () => {
    render(
      <HistoryPage
        entries={[pilotEntries[1]!]}
        errorMessage={null}
        isLoading={false}
        onRetry={vi.fn()}
        onSelectEntry={vi.fn()}
        selectedEntryId={null}
      />,
    );

    expect(screen.getByText("Nenhum evento de auditoria disponível para este contexto.")).toBeTruthy();
  });

  it("blames active filters only when persisted audit events exist", () => {
    render(
      <HistoryPage
        entries={pilotEntries}
        errorMessage={null}
        isLoading={false}
        onRetry={vi.fn()}
        onSelectEntry={vi.fn()}
        selectedEntryId={null}
      />,
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Buscar eventos por identificador ou ação" }), {
      target: { value: "event-that-does-not-exist" },
    });

    expect(screen.getByText("Nenhum evento de auditoria disponível para os filtros aplicados.")).toBeTruthy();
  });

  it("does not show a detail when the selected entry is absent from current events", () => {
    render(
      <HistoryPage
        entries={[pilotEntries[1]!]}
        errorMessage={null}
        isLoading={false}
        onRetry={vi.fn()}
        onSelectEntry={vi.fn()}
        selectedEntryId="entry-001"
      />,
    );

    expect(screen.queryByRole("region", { name: /detalhe da entrada/i })).toBeNull();
  });
});
