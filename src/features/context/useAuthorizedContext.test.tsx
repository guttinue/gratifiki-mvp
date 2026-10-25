import { act, cleanup, renderHook } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it } from "vitest";
import type { AuthorizedContext } from "../pilot/types";
import { useAuthorizedContext } from "./useAuthorizedContext";

const first: AuthorizedContext = {
  key: "one", actorId: "actor", role: "area_tecnica", vinculoId: "one", competenciaId: "month",
  competenciaCodigo: "MONTH", indicadorId: "indicator", escopoId: "unit", escopoCodigo: "UNIT", mode: "academic",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(cleanup);

it("requires an explicit choice for multiple links and refuses keys not returned by server", async () => {
  const client = { rpc: async () => ({ data: { contexts: [first, { ...first, key: "two", vinculoId: "two", role: "cam" }] }, error: null }) } as unknown as SupabaseClient;
  const { result } = renderHook(() => useAuthorizedContext(client));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.context).toBeNull();
  await act(async () => { await result.current.selectContext("forged"); });
  expect(result.current.context).toBeNull();
  await act(async () => { await result.current.selectContext("two"); });
  expect(result.current.context?.role).toBe("cam");
});

it("discards a delayed response after logout invalidation", async () => {
  const response = deferred<unknown>();
  const client = { rpc: () => response.promise } as unknown as SupabaseClient;
  const { result } = renderHook(() => useAuthorizedContext(client));
  let request!: Promise<boolean>;
  act(() => { request = result.current.refresh(); });
  act(() => { result.current.clear(); });
  await act(async () => {
    response.resolve({ data: { contexts: [first] }, error: null });
    await request;
  });
  expect(result.current.contexts).toEqual([]);
  expect(result.current.context).toBeNull();
});

it("clears the previous selection while revalidating, and never restores a revoked key locally", async () => {
  let contexts = [first];
  const client = { rpc: async () => ({ data: { contexts }, error: null }) } as unknown as SupabaseClient;
  const { result } = renderHook(() => useAuthorizedContext(client));
  await act(async () => { await result.current.refresh(); });
  expect(result.current.context?.key).toBe("one");
  contexts = [];
  await act(async () => { await result.current.refresh("one"); });
  await act(async () => { await result.current.selectContext("one"); });
  expect(result.current.context).toBeNull();
  expect(result.current.contexts).toEqual([]);
});

it("does not auto-select a different context when the requested key was revoked", async () => {
  let contexts = [first, { ...first, key: "two", vinculoId: "two" }];
  const client = { rpc: async () => ({ data: { contexts }, error: null }) } as unknown as SupabaseClient;
  const { result } = renderHook(() => useAuthorizedContext(client));
  await act(async () => { await result.current.refresh(); });
  contexts = [contexts[1]];
  await act(async () => { await result.current.selectContext("one"); });
  expect(result.current.context).toBeNull();
  expect(result.current.contexts.map(({ key }) => key)).toEqual(["two"]);
});
