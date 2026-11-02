import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PilotEntry } from "../lib/types";
import { createSupabaseClient } from "../lib/supabase";
import { pilotEntries, technicalContext } from "../features/workspace/workspaceTestFixtures";
import { App } from "./App";

const authMocks = vi.hoisted(() => ({
  getAuthClient: vi.fn(),
  getPilotContext: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const readModelMocks = vi.hoisted(() => ({ loadPilotEntries: vi.fn() }));
const contextMocks = vi.hoisted(() => ({ loadAuthorizedContexts: vi.fn() }));

vi.mock("../features/auth/auth", () => authMocks);
vi.mock("../features/entry/pilotReadModel", () => readModelMocks);
vi.mock("../features/context/contextApi", async (importOriginal) => ({
  ...await importOriginal<typeof import("../features/context/contextApi")>(),
  ...contextMocks,
}));

const legacyContext = {
  key: "legacy-link", vinculoId: "legacy-link", ...technicalContext,
  role: technicalContext.papel, mode: "legacy" as const,
};

function createAuthBoundary(hasSession = true) {
  const authListener = vi.fn();
  const session = hasSession ? {
    access_token: "test-session",
    user: { id: technicalContext.actorId },
  } : null;
  const client = {
    rpc: vi.fn().mockResolvedValue({ data: { items: [], total: 0, page: 1, pageSize: 25 }, error: null }),
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session },
        error: null,
      }),
      onAuthStateChange: vi.fn((callback: typeof authListener) => {
        authListener.mockImplementation(callback);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  } as unknown as SupabaseClient;

  return { client, authListener };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_only");
  const { client } = createAuthBoundary();
  authMocks.getAuthClient.mockReturnValue(client);
  authMocks.getPilotContext.mockResolvedValue(technicalContext);
  contextMocks.loadAuthorizedContexts.mockResolvedValue([legacyContext]);
  authMocks.signOut.mockResolvedValue(undefined);
  readModelMocks.loadPilotEntries.mockResolvedValue(pilotEntries);
});

describe("App", () => {
  it.each(["TOKEN_REFRESHED", "USER_UPDATED"])("preserves an authorized selected key through %s with multiple choices", async (event) => {
    const { client, authListener } = createAuthBoundary();
    authMocks.getAuthClient.mockReturnValue(client);
    contextMocks.loadAuthorizedContexts.mockResolvedValue([
      legacyContext, { ...legacyContext, key: "second", vinculoId: "second", mode: "academic", role: "cam" },
    ]);
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Contexto autorizado"), { target: { value: "legacy-link" } });
    await screen.findByRole("heading", { name: "Visão geral" });
    await act(async () => authListener(event, { user: { id: technicalContext.actorId } }));
    expect(await screen.findByRole("heading", { name: "Visão geral" })).toBeTruthy();
    expect((screen.getByLabelText("Contexto autorizado") as HTMLSelectElement).value).toBe("legacy-link");
  });

  it.each(["TOKEN_REFRESHED", "USER_UPDATED"])("never auto-switches from a revoked selected key to the remaining role during %s", async (event) => {
    const { client, authListener } = createAuthBoundary();
    authMocks.getAuthClient.mockReturnValue(client);
    render(<App />);
    await screen.findByRole("heading", { name: "Visão geral" });
    contextMocks.loadAuthorizedContexts.mockResolvedValue([
      { ...legacyContext, key: "remaining", vinculoId: "remaining", mode: "academic", role: "cam" },
    ]);
    await act(async () => authListener(event, { user: { id: technicalContext.actorId } }));
    expect(await screen.findByRole("heading", { name: "Selecione seu contexto" })).toBeTruthy();
    expect((screen.getByLabelText("Contexto autorizado") as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("heading", { name: "Contexto acadêmico autorizado" })).toBeNull();
  });

  it.each([
    ["success", "new-actor"], ["failure", "new-actor"],
    ["success", technicalContext.actorId], ["failure", technicalContext.actorId],
  ])("ignores delayed logout %s after a newer authentication establishes actor/context %s", async (outcome, nextActorId) => {
    const logout = deferred<void>();
    const { client, authListener } = createAuthBoundary();
    let session = { access_token: "actor-a", user: { id: technicalContext.actorId } };
    vi.mocked(client.auth.getSession).mockImplementation(async () => ({ data: { session: session as never }, error: null }));
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.signOut.mockReturnValueOnce(logout.promise);
    render(<App />);
    await screen.findByRole("heading", { name: "Visão geral" });
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    const nextPilot = { ...technicalContext, actorId: nextActorId, escopoCodigo: "NEW-ACTOR-SCOPE" };
    contextMocks.loadAuthorizedContexts.mockResolvedValue([
      { ...legacyContext, ...nextPilot, key: "new-link", vinculoId: "new-link" },
    ]);
    authMocks.getPilotContext.mockResolvedValue(nextPilot);
    authMocks.signIn.mockImplementationOnce(async () => {
      session = { access_token: "actor-b", user: { id: nextPilot.actorId } };
      authListener("SIGNED_IN", session);
    });
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "new@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "synthetic-only" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await screen.findByRole("heading", { name: "Visão geral" });
    expect(screen.getAllByText("NEW-ACTOR-SCOPE").length).toBeGreaterThan(0);
    const contextReads = contextMocks.loadAuthorizedContexts.mock.calls.length;
    await act(async () => {
      if (outcome === "success") logout.resolve();
      else logout.reject(new Error("old logout failed"));
    });
    expect(screen.queryByRole("heading", { name: "Visão geral" })).not.toBeNull();
    expect(contextMocks.loadAuthorizedContexts).toHaveBeenCalledTimes(contextReads);
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByRole("button", { name: "Sair" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("retains selected intent across overlapping renewals without silently switching to the remaining role", async () => {
    const pending = deferred<typeof legacyContext[]>();
    const { client, authListener } = createAuthBoundary();
    authMocks.getAuthClient.mockReturnValue(client);
    render(<App />);
    await screen.findByRole("heading", { name: "Visão geral" });
    contextMocks.loadAuthorizedContexts.mockReturnValueOnce(pending.promise);
    await act(async () => authListener("TOKEN_REFRESHED", { user: { id: technicalContext.actorId } }));
    contextMocks.loadAuthorizedContexts.mockResolvedValue([
      { ...legacyContext, key: "remaining", vinculoId: "remaining", mode: "academic", role: "cam" },
    ]);
    await act(async () => authListener("USER_UPDATED", { user: { id: technicalContext.actorId } }));
    expect(await screen.findByRole("heading", { name: "Selecione seu contexto" })).toBeTruthy();
    await act(async () => pending.resolve([legacyContext]));
    expect(screen.queryByRole("heading", { name: "Visão geral" })).toBeNull();
    expect((screen.getByLabelText("Contexto autorizado") as HTMLSelectElement).value).toBe("");
  });

  it("does not keep a renewed session busy on behalf of an invalidated pending logout", async () => {
    const logout = deferred<void>();
    const { client, authListener } = createAuthBoundary();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.signOut.mockReturnValueOnce(logout.promise);
    render(<App />);
    await screen.findByRole("heading", { name: "Visão geral" });
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    await act(async () => authListener("TOKEN_REFRESHED", { user: { id: technicalContext.actorId } }));
    await screen.findByRole("heading", { name: "Visão geral" });
    expect((screen.getByRole("button", { name: "Sair" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => logout.resolve());
    expect(screen.queryByRole("heading", { name: "Visão geral" })).not.toBeNull();
  });

  it("does not start context recovery when an older session lookup resolves after logout", async () => {
    const delayedSession = deferred<{ data: { session: { user: { id: string } } }; error: null }>();
    const { client, authListener } = createAuthBoundary();
    vi.mocked(client.auth.getSession).mockReturnValueOnce(delayedSession.promise as never);
    authMocks.getAuthClient.mockReturnValue(client);
    render(<App />);
    await act(async () => {
      authListener("SIGNED_OUT", null);
      delayedSession.resolve({ data: { session: { user: { id: technicalContext.actorId } } }, error: null });
    });
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
    expect(contextMocks.loadAuthorizedContexts).not.toHaveBeenCalled();
  });

  it("cancels a queued token recheck if logout occurs in the same turn", async () => {
    const { client, authListener } = createAuthBoundary();
    authMocks.getAuthClient.mockReturnValue(client);
    render(<App />);
    await screen.findByRole("heading", { name: "Visão geral" });
    contextMocks.loadAuthorizedContexts.mockClear();
    await act(async () => {
      authListener("TOKEN_REFRESHED", { user: { id: technicalContext.actorId } });
      authListener("SIGNED_OUT", null);
    });
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
    expect(contextMocks.loadAuthorizedContexts).not.toHaveBeenCalled();
  });

  it("returns to access denied when a legacy link is revoked between discovery and adapter", async () => {
    authMocks.getPilotContext.mockResolvedValueOnce(null);
    render(<App />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Navegação principal" })).toBeNull();
  });
  it("keeps two authorized links available instead of rejecting the session", async () => {
    contextMocks.loadAuthorizedContexts.mockResolvedValue([
      legacyContext,
      { ...legacyContext, key: "academic-link", vinculoId: "academic-link", mode: "academic", role: "lideranca" },
    ]);
    render(<App />);
    expect(await screen.findByLabelText("Contexto autorizado")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Navegação principal" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Contexto autorizado"), { target: { value: "academic-link" } });
    expect(await screen.findByRole("heading", { name: "Contexto acadêmico autorizado" })).toBeTruthy();
    expect(screen.queryByText("Visão geral", { exact: true })).toBeNull();
    expect(screen.queryByRole("button", { name: /registrar entrada/i })).toBeNull();
    expect(readModelMocks.loadPilotEntries).not.toHaveBeenCalled();
  });

  it("clears visible data and ignores an older read when the context changes", async () => {
    const delayedRead = deferred<PilotEntry[]>();
    contextMocks.loadAuthorizedContexts.mockResolvedValue([
      legacyContext,
      { ...legacyContext, key: "academic-link", vinculoId: "academic-link", mode: "academic", role: "cam" },
    ]);
    readModelMocks.loadPilotEntries.mockReturnValueOnce(delayedRead.promise);
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Contexto autorizado"), { target: { value: "legacy-link" } });
    await screen.findByRole("heading", { name: "Visão geral" });
    fireEvent.change(screen.getByLabelText("Contexto autorizado"), { target: { value: "academic-link" } });
    await screen.findByRole("heading", { name: "Contexto acadêmico autorizado" });
    await act(async () => delayedRead.resolve(pilotEntries));
    expect(screen.queryByRole("navigation", { name: "Navegação principal" })).toBeNull();
    expect(screen.queryByText("entry-001")).toBeNull();
  });

  it("rechecks token refresh and clears a revoked context without reviving old choices", async () => {
    const { client, authListener } = createAuthBoundary();
    authMocks.getAuthClient.mockReturnValue(client);
    render(<App />);
    await screen.findByRole("heading", { name: "Visão geral" });
    contextMocks.loadAuthorizedContexts.mockResolvedValue([]);
    await act(async () => authListener("TOKEN_REFRESHED", { user: { id: technicalContext.actorId } }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Navegação principal" })).toBeNull();
    expect(screen.queryByRole("option", { name: /area_tecnica/ })).toBeNull();
  });
  it("restores the authorized session into the operational overview", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Visão geral" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Navegação principal" })).toBeTruthy();
    expect(screen.getAllByText("DEMO-ESCOPO-01").length).toBeGreaterThan(0);
    expect(screen.getByRole("complementary", { name: "Aviso do ambiente" }).textContent).toMatch(/local.*sintéticos/i);
    expect(screen.queryByRole("textbox", { name: "Valor para o indicador" })).toBeNull();
  });

  it("uses only allowed hashes and updates the page when navigation changes", async () => {
    window.history.replaceState({}, "", "/#unknown");
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Visão geral" })).toBeTruthy();
    await waitFor(() => expect(window.location.hash).toBe("#overview"));

    fireEvent.click(screen.getByRole("link", { name: "Entradas" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Entradas" })).toBeTruthy();
    expect(window.location.hash).toBe("#entries");

    fireEvent.click(screen.getByRole("link", { name: "Histórico e auditoria" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeTruthy();
    expect(window.location.hash).toBe("#history");
  });

  it("restores an allowed hash and responds to browser back and forward navigation", async () => {
    window.history.replaceState({}, "", "/#entries");
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Entradas" })).toBeTruthy();

    window.location.hash = "#history";
    expect(await screen.findByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeTruthy();

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Entradas" })).toBeTruthy();

    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeTruthy();
  });

  it("keeps the technical form state mounted while navigating away and back", async () => {
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Entradas" }));
    const valueInput = await screen.findByLabelText("Valor para o indicador");
    fireEvent.change(valueInput, { target: { value: "12.3400" } });

    fireEvent.click(screen.getByRole("link", { name: "Histórico e auditoria" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Valor para o indicador" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Entradas" }));
    expect((await screen.findByLabelText("Valor para o indicador") as HTMLInputElement).value).toBe("12.3400");
  });

  it("shows a recoverable read error and reloads authorized entries on retry", async () => {
    readModelMocks.loadPilotEntries.mockRejectedValueOnce(new Error("read failed"));
    render(<App />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /tentar novamente/i }));

    expect(await screen.findByRole("row", { name: /entry-001/i })).toBeTruthy();
    expect(readModelMocks.loadPilotEntries).toHaveBeenCalledTimes(2);
  });

  it("clears the workspace on logout and ignores an earlier read that resolves afterward", async () => {
    const delayedRead = deferred<PilotEntry[]>();
    readModelMocks.loadPilotEntries.mockReturnValueOnce(delayedRead.promise);
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Visão geral" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();

    await act(async () => delayedRead.resolve(pilotEntries));
    expect(screen.queryByRole("navigation", { name: "Navegação principal" })).toBeNull();
    expect(screen.queryByText("entry-001")).toBeNull();
  });

  it("discards a delayed login context after the session signs out", async () => {
    const delayedContext = deferred<typeof technicalContext | null>();
    const { client, authListener } = createAuthBoundary(false);
    let currentSession: { access_token: string; user: { id: string } } | null = null;
    vi.mocked(client.auth.getSession).mockImplementation(async () => ({
      data: { session: currentSession as never },
      error: null,
    }));
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.signIn.mockImplementationOnce(async () => {
      currentSession = { access_token: "login-session-a", user: { id: technicalContext.actorId } };
      authListener("SIGNED_IN", currentSession);
    });
    authMocks.getPilotContext.mockReturnValueOnce(delayedContext.promise);

    render(<App />);
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "area@example.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "not-a-real-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(authMocks.getPilotContext).toHaveBeenCalledOnce());

    await act(async () => {
      currentSession = null;
      authListener("SIGNED_OUT", null);
      delayedContext.resolve(technicalContext);
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Acesse o piloto local" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Navegação principal" })).toBeNull();
    expect(screen.queryByText("DEMO-ESCOPO-01", { exact: true })).toBeNull();
  });

  it("discards a delayed login context when the signed-in actor changes", async () => {
    const delayedContext = deferred<typeof technicalContext | null>();
    const { client, authListener } = createAuthBoundary(false);
    let currentSession: { access_token: string; user: { id: string } } | null = null;
    vi.mocked(client.auth.getSession).mockImplementation(async () => ({
      data: { session: currentSession as never },
      error: null,
    }));
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.signIn.mockImplementationOnce(async () => {
      currentSession = { access_token: "login-session-a", user: { id: technicalContext.actorId } };
      authListener("SIGNED_IN", currentSession);
    });
    authMocks.getPilotContext.mockReturnValueOnce(delayedContext.promise);

    render(<App />);
    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "area@example.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "not-a-real-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(authMocks.getPilotContext).toHaveBeenCalledOnce());

    await act(async () => {
      currentSession = { access_token: "login-session-b", user: { id: "d3mo0000-0000-4000-8000-000000000002" } };
      authListener("SIGNED_IN", currentSession);
      delayedContext.resolve(technicalContext);
    });

    expect(await screen.findByRole("heading", { level: 1, name: "Acesse o piloto local" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Navegação principal" })).toBeNull();
    expect(screen.queryByText("DEMO-ESCOPO-01", { exact: true })).toBeNull();
  });

  it("keeps the session error visible and lets the user retry a failed logout", async () => {
    authMocks.signOut.mockRejectedValueOnce(new Error("network error")).mockResolvedValueOnce(undefined);
    render(<App />);

    await screen.findByRole("heading", { level: 1, name: "Visão geral" });
    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Sair" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Sair" }));
    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
  });

  it("shows login when no authenticated session can be restored", async () => {
    const { client } = createAuthBoundary(false);
    authMocks.getAuthClient.mockReturnValue(client);
    render(<App />);

    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Acesse o piloto local" })).toBeTruthy();
    expect(authMocks.getPilotContext).not.toHaveBeenCalled();
    expect(screen.queryByRole("navigation", { name: "Navegação principal" })).toBeNull();
  });

  it("starts a fresh sign-in on the overview even when the login page has another allowed hash", async () => {
    const { client, authListener } = createAuthBoundary(false);
    let currentSession: { access_token: string; user: { id: string } } | null = null;
    vi.mocked(client.auth.getSession).mockImplementation(async () => ({
      data: { session: currentSession as never },
      error: null,
    }));
    authMocks.signIn.mockImplementationOnce(async () => {
      currentSession = { access_token: "fresh-login-session", user: { id: technicalContext.actorId } };
      authListener("SIGNED_IN", currentSession);
    });
    authMocks.getAuthClient.mockReturnValue(client);
    window.history.replaceState({}, "", "/#history");
    render(<App />);

    fireEvent.change(await screen.findByLabelText("E-mail"), { target: { value: "area@example.test" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "not-a-real-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Visão geral" })).toBeTruthy();
    expect(window.location.hash).toBe("#overview");
  });

  it("moves skip-link focus to the current page without changing its route", async () => {
    render(<App />);
    await screen.findByRole("heading", { level: 1, name: "Visão geral" });

    fireEvent.click(screen.getByRole("link", { name: "Entradas" }));
    await screen.findByRole("heading", { level: 1, name: "Entradas" });
    fireEvent.click(screen.getByRole("link", { name: "Pular para o conteúdo" }));

    expect(document.activeElement).toBe(screen.getByRole("main"));
    await waitFor(() => expect(window.location.hash).toBe("#entries"));
    expect(screen.getByRole("heading", { level: 1, name: "Entradas" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Histórico e auditoria" }));
    await screen.findByRole("heading", { level: 1, name: "Histórico e auditoria" });
    fireEvent.click(screen.getByRole("link", { name: "Pular para o conteúdo" }));

    expect(document.activeElement).toBe(screen.getByRole("main"));
    await waitFor(() => expect(window.location.hash).toBe("#history"));
    expect(screen.getByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeTruthy();
  });
});

describe("App academic access boundary", () => {
  const academicTechnical = {
    ...legacyContext, key: "academic-technical", vinculoId: "academic-technical", mode: "academic" as const,
    role: "area_tecnica" as const, escopoCodigo: "NORTE", competenciaCodigo: "2026-10",
  };
  const position = {
    id: "pos", escopoId: "scope", escopoCodigo: "NORTE-1", escopoTipo: "unidade", aplicavel: true, status: "ausente",
    estadoDado: null, version: 1, revisionId: null, inputValue: null, resultValue: null,
  };
  const editedSource = "Fonte sintética em edição";
  type RpcResult = { data: unknown; error: unknown };
  function academicBoundary() {
    const boundary = createAuthBoundary();
    const overrides = new Map<string, () => Promise<RpcResult>>();
    vi.mocked(boundary.client.rpc).mockImplementation(((name: string) => {
      const override = overrides.get(name);
      if (override) { overrides.delete(name); return override(); }
      if (name === "get_operational_positions") return Promise.resolve({ data: { items: [position], total: 1, page: 1, pageSize: 25 }, error: null });
      if (name === "get_position_detail") return Promise.resolve({ data: { position, revisions: [], decisions: [], memories: [] }, error: null });
      return Promise.resolve({ data: null, error: null });
    }) as never);
    authMocks.getAuthClient.mockReturnValue(boundary.client);
    contextMocks.loadAuthorizedContexts.mockResolvedValue([academicTechnical]);
    return { ...boundary, overrides };
  }
  async function openDraftAndEdit() {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /NORTE-1 · ausente/ }));
    fireEvent.change(await screen.findByLabelText("Fonte"), { target: { value: editedSource } });
  }
  const denied = () => Promise.resolve({ data: null, error: { code: "42501", message: "access_denied" } });
  const workspaceHeading = () => screen.queryByRole("heading", { name: "Contexto acadêmico autorizado" });
  // Refreshing a list with an unsaved draft asks before leaving; accept it.
  const acceptLeave = () => vi.spyOn(window, "confirm").mockReturnValue(true);
  afterEach(() => vi.restoreAllMocks());

  it("hides the workspace while a valid renewal revalidates and then restores the same unsaved edit", async () => {
    const { authListener } = academicBoundary();
    await openDraftAndEdit();
    const pending = deferred<typeof academicTechnical[]>();
    contextMocks.loadAuthorizedContexts.mockReturnValueOnce(pending.promise);
    await act(async () => authListener("TOKEN_REFRESHED", { user: { id: technicalContext.actorId } }));
    expect(workspaceHeading()).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Fonte" })).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/Verificando o acesso/);
    await act(async () => pending.resolve([academicTechnical]));
    expect(workspaceHeading()).not.toBeNull();
    expect((screen.getByRole("textbox", { name: "Fonte" }) as HTMLInputElement).value).toBe(editedSource);
  });

  it("discards the hidden edit when the renewal shows the context was revoked", async () => {
    const { authListener } = academicBoundary();
    await openDraftAndEdit();
    contextMocks.loadAuthorizedContexts.mockResolvedValue([]);
    await act(async () => authListener("TOKEN_REFRESHED", { user: { id: technicalContext.actorId } }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(workspaceHeading()).toBeNull();
    expect(screen.queryByDisplayValue(editedSource)).toBeNull();
    expect(screen.queryByText("NORTE-1")).toBeNull();
  });

  it("keeps content hidden while authorization is unknown and restores it only after a positive recheck", async () => {
    const { authListener } = academicBoundary();
    await openDraftAndEdit();
    contextMocks.loadAuthorizedContexts.mockRejectedValueOnce(new Error("offline"));
    await act(async () => authListener("TOKEN_REFRESHED", { user: { id: technicalContext.actorId } }));
    const retry = await screen.findByRole("button", { name: "Verificar acesso novamente" });
    expect(workspaceHeading()).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Fonte" })).toBeNull();
    await act(async () => fireEvent.click(retry));
    expect(workspaceHeading()).not.toBeNull();
    expect((screen.getByRole("textbox", { name: "Fonte" }) as HTMLInputElement).value).toBe(editedSource);
  });

  it("removes previously loaded detail after a read is denied and discovery confirms the revocation", async () => {
    const { overrides } = academicBoundary();
    await openDraftAndEdit();
    acceptLeave();
    expect(screen.getByRole("heading", { name: "NORTE-1" })).toBeTruthy();
    contextMocks.loadAuthorizedContexts.mockResolvedValue([]);
    overrides.set("get_operational_positions", denied);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Atualizar consulta" })));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(workspaceHeading()).toBeNull();
    expect(screen.queryByText("NORTE-1")).toBeNull();
    expect(screen.queryByDisplayValue(editedSource)).toBeNull();
  });

  it("keeps the workspace when a denial is not a revocation and treats network failures as non-revoking", async () => {
    const { overrides } = academicBoundary();
    await openDraftAndEdit();
    acceptLeave();
    const discoveryCalls = contextMocks.loadAuthorizedContexts.mock.calls.length;
    overrides.set("get_operational_positions", () => Promise.resolve({ data: null, error: { message: "Failed to fetch" } }));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Atualizar consulta" })));
    expect(contextMocks.loadAuthorizedContexts).toHaveBeenCalledTimes(discoveryCalls);
    overrides.set("get_operational_positions", denied);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Atualizar consulta" })));
    await waitFor(() => expect(contextMocks.loadAuthorizedContexts).toHaveBeenCalledTimes(discoveryCalls + 1));
    expect(workspaceHeading()).not.toBeNull();
    expect(await screen.findByRole("button", { name: /NORTE-1 · ausente/ })).toBeTruthy();
  });

  it("does not let a delayed read restore content after the context is revoked", async () => {
    const { authListener, overrides } = academicBoundary();
    render(<App />);
    const late = deferred<RpcResult>();
    overrides.set("get_position_detail", () => late.promise);
    fireEvent.click(await screen.findByRole("button", { name: /NORTE-1 · ausente/ }));
    contextMocks.loadAuthorizedContexts.mockResolvedValue([]);
    await act(async () => authListener("TOKEN_REFRESHED", { user: { id: technicalContext.actorId } }));
    await screen.findByRole("alert");
    await act(async () => late.resolve({ data: { position, revisions: [], decisions: [], memories: [] }, error: null }));
    expect(screen.queryByText("NORTE-1")).toBeNull();
    expect(screen.queryByLabelText("Fonte")).toBeNull();
  });
});

describe("createSupabaseClient", () => {
  it("fails fast when the public Supabase URL is missing", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_only");

    expect(() => createSupabaseClient()).toThrow("VITE_SUPABASE_URL");
  });

  it("fails fast when the publishable key is missing", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");

    expect(() => createSupabaseClient()).toThrow("VITE_SUPABASE_PUBLISHABLE_KEY");
  });

  it("returns a Supabase client when public configuration is present", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_only");

    expect(createSupabaseClient().from("indicator_records")).toBeTruthy();
  });
});
