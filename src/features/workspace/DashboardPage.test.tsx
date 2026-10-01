import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pilotEntries, technicalContext } from "./workspaceTestFixtures";
import { DashboardPage } from "./DashboardPage";

afterEach(cleanup);

describe("DashboardPage", () => {
  it("does not present loading values as confirmed zero metrics", () => {
    render(<DashboardPage context={technicalContext} entries={[]} errorMessage={null} isLoading onNavigate={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toMatch(/carregando/i);
    expect(screen.queryByText("0", { selector: ".metric-value" })).toBeNull();
  });

  it("shows a recoverable read error without rendering confirmed metrics", () => {
    const onRetry = vi.fn();
    render(
      <DashboardPage context={technicalContext} entries={[]} errorMessage="Falha de leitura." isLoading={false} onNavigate={vi.fn()} onRetry={onRetry} />,
    );

    expect(screen.getByRole("alert").textContent).toContain("Falha de leitura.");
    fireEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(screen.queryByText("0", { selector: ".metric-value" })).toBeNull();
  });

  it("shows an honest empty state and routes the technical user to entries", () => {
    const onNavigate = vi.fn();
    render(
      <DashboardPage context={technicalContext} entries={[]} errorMessage={null} isLoading={false} onNavigate={onNavigate} />,
    );

    expect(screen.getByText(/ainda não há entradas/i)).toBeTruthy();
    expect(screen.queryByRole("row", { name: /entry-/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /abrir entradas/i }));
    expect(onNavigate).toHaveBeenCalledWith("entries");
  });

  it("renders real counts, state distribution, recent entries, and submission activity", () => {
    render(
      <DashboardPage context={technicalContext} entries={pilotEntries} errorMessage={null} isLoading={false} onNavigate={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Visão geral" })).toBeTruthy();
    expect(screen.getByText("Entradas", { selector: ".metric-label" })).toBeTruthy();
    expect(screen.getByText("3", { selector: ".metric-value" })).toBeTruthy();
    expect(screen.getByText("Resultados persistidos", { selector: ".metric-label" })).toBeTruthy();
    expect(screen.getByText("1", { selector: ".metric-value" })).toBeTruthy();
    expect(screen.getByText("Pendentes", { selector: ".metric-label" })).toBeTruthy();
    const pendingMetric = screen.getByText("Pendentes", { selector: ".metric-label" }).closest<HTMLElement>(".metric-card");
    expect(pendingMetric).not.toBeNull();
    expect(within(pendingMetric!).getByText("2", { selector: ".metric-value" })).toBeTruthy();
    expect(screen.getByText("Eventos de auditoria", { selector: ".metric-label" })).toBeTruthy();
    const eventMetric = screen.getByText("Eventos de auditoria", { selector: ".metric-label" }).closest<HTMLElement>(".metric-card");
    expect(eventMetric).not.toBeNull();
    expect(within(eventMetric!).getByText("2", { selector: ".metric-value" })).toBeTruthy();

    const distribution = screen.getByRole("region", { name: "Distribuição por estado" });
    expect(within(distribution).getByText("Pendente")).toBeTruthy();
    expect(within(distribution).getByText("Validada")).toBeTruthy();
    expect(screen.getByRole("row", { name: /entry-001/i })).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "Atividade recente" })).getAllByText("Entrada enviada").length).toBe(2);
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("keys duplicate persisted result values by result identity", () => {
    const entry = pilotEntries[0]!;
    const persistedResult = entry.results[0]!;
    const entryWithEqualValues = {
      ...entry,
      results: [persistedResult, { ...persistedResult, resultId: "result-duplicate" }],
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(
        <DashboardPage
          context={technicalContext}
          entries={[entryWithEqualValues]}
          errorMessage={null}
          isLoading={false}
          onNavigate={vi.fn()}
        />,
      );

      expect(screen.getAllByText("8.096000", { selector: ".result-code" })).toHaveLength(2);
      expect(consoleError.mock.calls.some(([message]) => /same key/i.test(String(message)))).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});
