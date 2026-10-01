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

vi.mock("../features/auth/auth", () => authMocks);
vi.mock("../features/entry/pilotReadModel", () => readModelMocks);

function createAuthBoundary(hasSession = true) {
  const authListener = vi.fn();
  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: hasSession ? { access_token: "test-session" } : null },
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
  authMocks.signOut.mockResolvedValue(undefined);
  readModelMocks.loadPilotEntries.mockResolvedValue(pilotEntries);
});

describe("App", () => {
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
