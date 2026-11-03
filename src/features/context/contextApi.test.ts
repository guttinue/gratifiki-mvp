import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { loadAuthorizedContexts, toCommandContext } from "./contextApi";
import type { AuthorizedContext } from "../pilot/types";

export const contextFixture: AuthorizedContext = {
  key: "link:month:indicator", actorId: "actor", role: "area_tecnica", vinculoId: "link",
  competenciaId: "month", competenciaCodigo: "SYNTHETIC-MONTH", indicadorId: "indicator",
  escopoId: "unit", escopoCodigo: "SYNTHETIC-UNIT", mode: "academic", modelo: 2,
};

describe("authorized contexts boundary", () => {
  it("never_accepts_a_role_from_storage", () => {
    localStorage.setItem("role", "administrador");
    expect(toCommandContext({ ...contextFixture, role: "cam" })).toEqual({
      vinculoId: "link", competenciaId: "month", indicadorId: "indicator",
    });
    localStorage.clear();
  });

  it("loads server-authorized choices without sending role, scope or local storage", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { contexts: [contextFixture] }, error: null });
    const client = { rpc } as unknown as SupabaseClient;
    expect(await loadAuthorizedContexts(client)).toEqual([contextFixture]);
    expect(rpc).toHaveBeenCalledWith("get_authorized_contexts");
  });

  it("accepts a context without modelo, assuming 2 for academic and 1 for legacy", async () => {
    const withoutModelo: Record<string, unknown> = { ...contextFixture };
    delete withoutModelo.modelo;
    const legacy = { ...withoutModelo, key: "legacy", mode: "legacy", role: "cam" };
    const client = { rpc: async () => ({ data: { contexts: [withoutModelo, legacy] }, error: null }) } as unknown as SupabaseClient;
    const loaded = await loadAuthorizedContexts(client);
    expect(loaded.map(({ modelo }) => modelo)).toEqual([2, 1]);
  });

  it("keeps the modelo the server emits", async () => {
    const client = { rpc: async () => ({ data: { contexts: [{ ...contextFixture, modelo: 3 }] }, error: null }) } as unknown as SupabaseClient;
    expect((await loadAuthorizedContexts(client))[0].modelo).toBe(3);
  });

  it.each([
    { contexts: [{ ...contextFixture, modelo: 4 }] },
    { contexts: [{ ...contextFixture, modelo: "2" }] },
    { contexts: [{ ...contextFixture, role: "superuser" }] },
    { contexts: [{ ...contextFixture, mode: "prototype" }] },
    { contexts: [{ ...contextFixture, actorId: null }] },
    { contexts: [contextFixture, contextFixture] },
    { contexts: [{ ...contextFixture, mode: "legacy", role: "lideranca" }] },
    { contexts: null },
  ])("rejects malformed or ambiguous backend contexts", async (data) => {
    const client = { rpc: async () => ({ data, error: null }) } as unknown as SupabaseClient;
    await expect(loadAuthorizedContexts(client)).rejects.toThrow();
  });
});
