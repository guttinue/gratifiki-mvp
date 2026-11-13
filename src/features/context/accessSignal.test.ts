import { createClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import { withAccessDeniedSignal } from "./accessSignal";
import { runCommand } from "../pilot/commandApi";
import { listPositions } from "../submission/positionApi";

const context = { vinculoId: "link", competenciaId: "month", indicadorId: "indicator" };
function client(status: number, body: unknown) {
  return createClient("http://127.0.0.1:54321", "key", { auth: { persistSession: false, storageKey: crypto.randomUUID() },
    global: { fetch: async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) } });
}

it("signals explicit denials of context-bound reads and commands without changing their errors", async () => {
  const onDenied = vi.fn();
  const guarded = withAccessDeniedSignal(client(403, { code: "42501", message: "access_denied" }), onDenied);
  await expect(listPositions(guarded, context, { page: 1, pageSize: 25 })).rejects.toMatchObject({ code: "42501" });
  await expect(runCommand(guarded, "submit_position", context, {}, "op")).rejects.toMatchObject({ code: "access_denied", confirmedRejected: true });
  expect(onDenied).toHaveBeenCalledTimes(2);
});

it("ignores conflicts, network-shaped failures and calls without a context", async () => {
  const onDenied = vi.fn();
  await expect(runCommand(withAccessDeniedSignal(client(409, { code: "40001", message: "version_conflict" }), onDenied), "submit_position", context, {}, "op")).rejects.toMatchObject({ code: "version_conflict" });
  await expect(listPositions(withAccessDeniedSignal(client(500, { message: "Failed to fetch" }), onDenied), context, { page: 1, pageSize: 25 })).rejects.toBeTruthy();
  const { error } = await withAccessDeniedSignal(client(403, { code: "42501", message: "access_denied" }), onDenied).rpc("get_authorized_contexts");
  expect(error).toMatchObject({ code: "42501" });
  expect(onDenied).not.toHaveBeenCalled();
});

it("keeps the rest of the client usable through the wrapper", () => {
  const raw = client(200, {});
  const guarded = withAccessDeniedSignal(raw, vi.fn());
  expect(guarded.auth).toBe(raw.auth);
  expect(typeof guarded.from("competencias").select).toBe("function");
});
