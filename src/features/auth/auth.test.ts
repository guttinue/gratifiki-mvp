import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";
import { getPilotContext } from "./auth";

it("adapts a server-selected legacy context without hardcoded month or indicator codes", async () => {
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "actor" } }, error: null }) },
    rpc: async () => ({ data: { contexts: [{ key: "chosen", actorId: "actor", vinculoId: "link", role: "cam", competenciaId: "month", competenciaCodigo: "OTHER-MONTH", indicadorId: "indicator", escopoId: "scope", escopoCodigo: "OTHER-SCOPE", mode: "legacy" }] }, error: null }),
    from: (table: string) => ({ select: () => ({ eq: (_field: string, id: string) => ({ maybeSingle: async () => ({ data: table === "competencias" ? { id, referencia: "2026-08-01" } : { id, codigo: "OTHER-INDICATOR" }, error: null }) }) }) }),
  } as unknown as SupabaseClient;
  expect(await getPilotContext(client, "chosen")).toEqual({
    actorId: "actor", papel: "cam", competenciaId: "month", competenciaCodigo: "OTHER-MONTH",
    referencia: "2026-08-01", indicadorId: "indicator", indicadorCodigo: "OTHER-INDICATOR",
    escopoId: "scope", escopoCodigo: "OTHER-SCOPE",
  });
  expect(await getPilotContext(client, "forged")).toBeNull();
});
