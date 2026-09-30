import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseClient } from "../lib/supabase";
import { App } from "./App";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_only");
});

describe("App", () => {
  it("shows the local demonstration state without institutional claims", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /^Ambiente local de demonstração$/,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByText(/SESAU|Secretaria de Saúde|homologad[oa]|em produção|oficial/i),
    ).toBeNull();
  });

  it("requires authentication before showing a protected pilot workspace", async () => {
    render(<App />);

    expect(await screen.findByLabelText("E-mail")).toBeTruthy();
    expect(screen.getByLabelText("Senha")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /registrar entrada/i })).toBeNull();
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
