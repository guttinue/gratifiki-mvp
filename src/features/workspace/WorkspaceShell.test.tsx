import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { technicalContext } from "./workspaceTestFixtures";
import { WorkspaceShell } from "./WorkspaceShell";

afterEach(cleanup);

describe("WorkspaceShell", () => {
  it("shows authorized context and marks the current navigation destination", () => {
    render(
      <WorkspaceShell
        context={technicalContext}
        isSigningOut={false}
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        page="entries"
      >
        <h1>Entradas</h1>
      </WorkspaceShell>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Entradas" })).toBeTruthy();
    expect(screen.getByText("DEMO-ESCOPO-01")).toBeTruthy();
    expect(screen.getByText("Área técnica")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Entradas" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getAllByText(/local|sintéticos/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("routes by page link and allows sign-out from the workspace", () => {
    const onNavigate = vi.fn();
    const onSignOut = vi.fn();
    render(
      <WorkspaceShell
        context={technicalContext}
        isSigningOut={false}
        onNavigate={onNavigate}
        onSignOut={onSignOut}
        page="overview"
      >
        <h1>Visão geral</h1>
      </WorkspaceShell>,
    );

    fireEvent.click(screen.getByRole("link", { name: "Histórico e auditoria" }));
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));

    expect(onNavigate).toHaveBeenCalledWith("history");
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("announces an unavailable sign-out and disables its retry only while a retry is running", () => {
    const { rerender } = render(
      <WorkspaceShell
        context={technicalContext}
        isSigningOut={false}
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        page="overview"
        signOutError="Não foi possível encerrar a sessão agora."
      >
        <h1>Visão geral</h1>
      </WorkspaceShell>,
    );

    expect(screen.getByRole("alert").textContent).toContain("Não foi possível encerrar");
    expect((screen.getByRole("button", { name: "Sair" }) as HTMLButtonElement).disabled).toBe(false);

    rerender(
      <WorkspaceShell
        context={technicalContext}
        isSigningOut
        onNavigate={vi.fn()}
        onSignOut={vi.fn()}
        page="overview"
      >
        <h1>Visão geral</h1>
      </WorkspaceShell>,
    );
    expect((screen.getByRole("button", { name: /saindo/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
