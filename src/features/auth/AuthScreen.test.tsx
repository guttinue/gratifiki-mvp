import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotContext } from "../../lib/types";
import { technicalContext } from "../workspace/workspaceTestFixtures";
import { getPilotContext, signIn } from "./auth";
import { AuthScreen } from "./AuthScreen";

vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>();
  return { ...actual, getPilotContext: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
});

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_only");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

describe("AuthScreen", () => {
  it("allows the app to discover multiple authorized contexts after login without the legacy adapter", async () => {
    const onSessionAuthenticated = vi.fn().mockResolvedValue(true);
    vi.mocked(signIn).mockResolvedValueOnce();
    render(<AuthScreen client={{} as SupabaseClient} onSessionAuthenticated={onSessionAuthenticated} />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "area@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(onSessionAuthenticated).toHaveBeenCalledOnce());
    expect(getPilotContext).not.toHaveBeenCalled();
  });
  it("shows an invalid-credentials error without revealing protected UI", async () => {
    vi.mocked(signIn).mockRejectedValueOnce(new Error("Invalid login credentials"));

    render(<AuthScreen />);
    fireEvent.change(screen.getByLabelText("E-mail"), {
      target: { value: "demo@example.invalid" },
    });
    fireEvent.change(screen.getByLabelText("Senha"), {
      target: { value: "incorrect-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/não foi possível entrar/i);
    });
    expect(screen.queryByRole("region", { name: "Área protegida" })).toBeNull();
    expect(screen.queryByRole("button", { name: /registrar entrada|aprovar|fechar/i })).toBeNull();
    expect(screen.queryByText(/DEMO-01|escopo:/i)).toBeNull();
    expect((screen.getByLabelText("Senha") as HTMLInputElement).value).toBe("");
  });

  it("uses the same Supabase client for sign in and context loading", async () => {
    const client = {} as SupabaseClient;
    const context: PilotContext = {
      actorId: "d3mo0000-0000-4000-8000-000000000001",
      papel: "area_tecnica",
      competenciaId: "c0de0000-0000-4000-8000-000000000001",
      competenciaCodigo: "DEMO-2026-09",
      referencia: "2026-09-15",
      indicadorId: "c0de0000-0000-4000-8000-000000000002",
      indicadorCodigo: "DEMO-01",
      escopoId: "c0de0000-0000-4000-8000-000000000003",
      escopoCodigo: "DEMO-ESCOPO-01",
    };
    vi.mocked(signIn).mockResolvedValueOnce();
    vi.mocked(getPilotContext).mockResolvedValueOnce(context);

    render(<AuthScreen client={client} />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "area@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() => {
      expect(vi.mocked(signIn)).toHaveBeenCalledWith("area@example.invalid", "test-only-password", client);
      expect(vi.mocked(getPilotContext)).toHaveBeenCalledWith(client);
    });
    expect(await screen.findByRole("heading", { level: 1, name: "Contexto autorizado" })).toBeTruthy();
    expect(screen.getByText("Perfil: area_tecnica")).toBeTruthy();
  });

  it("does not complete an authentication callback after AuthScreen unmounts", async () => {
    const client = {} as SupabaseClient;
    const delayedContext = deferred<PilotContext | null>();
    const onAuthenticated = vi.fn();
    vi.mocked(signIn).mockResolvedValueOnce();
    vi.mocked(getPilotContext).mockReturnValueOnce(delayedContext.promise);

    const view = render(<AuthScreen client={client} onAuthenticated={onAuthenticated} />);
    fireEvent.change(screen.getByLabelText("E-mail"), { target: { value: "area@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(getPilotContext).toHaveBeenCalledOnce());
    view.unmount();

    await act(async () => delayedContext.resolve(technicalContext));

    expect(onAuthenticated).not.toHaveBeenCalled();
  });
});
