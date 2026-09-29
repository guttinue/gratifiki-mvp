import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signIn } from "./auth";
import { AuthScreen } from "./AuthScreen";

vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>();
  return { ...actual, signIn: vi.fn(), signOut: vi.fn() };
});

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_only");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthScreen", () => {
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
  });
});
