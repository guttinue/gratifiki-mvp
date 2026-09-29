import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSupabaseClient } from "../lib/supabase";
import { App } from "./App";

afterEach(() => {
  vi.unstubAllEnvs();
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
