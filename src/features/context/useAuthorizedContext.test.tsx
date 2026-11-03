import { act, cleanup, renderHook } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, expect, it } from "vitest";
import type { AuthorizedContext } from "../pilot/types";
import { useAuthorizedContext } from "./useAuthorizedContext";

const first: AuthorizedContext = {
  key: "one", actorId: "actor", role: "area_tecnica", vinculoId: "one", competenciaId: "month",
  competenciaCodigo: "MONTH", indicadorId: "indicator", escopoId: "unit", escopoCodigo: "UNIT", mode: "academic", modelo: 2,
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
  await act(async () => { await result.current.selectContext("cam:month:unit"); });
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
  await act(async () => { await result.current.refresh("area_tecnica:month:unit"); });
  await act(async () => { await result.current.selectContext("area_tecnica:month:unit"); });
  expect(result.current.context).toBeNull();
  expect(result.current.contexts).toEqual([]);
});

it("does not auto-select a different context when the requested key was revoked", async () => {
  let contexts = [first, { ...first, key: "two", vinculoId: "two", escopoId: "other", escopoCodigo: "OTHER" }];
  const client = { rpc: async () => ({ data: { contexts }, error: null }) } as unknown as SupabaseClient;
  const { result } = renderHook(() => useAuthorizedContext(client));
  await act(async () => { await result.current.refresh(); });
  contexts = [contexts[1]];
  await act(async () => { await result.current.selectContext("area_tecnica:month:unit"); });
  expect(result.current.context).toBeNull();
  expect(result.current.contexts.map(({ key }) => key)).toEqual(["two"]);
});

const indicators = [1, 2].map((n) => ({ ...first, key: `ind-${n}`, vinculoId: `link-${n}`, indicadorId: `indicator-${n}` }));
const groupKey = "area_tecnica:month:unit";
function groupedHook(initial: AuthorizedContext[]) {
  let contexts = initial;
  const client = { rpc: async () => ({ data: { contexts }, error: null }) } as unknown as SupabaseClient;
  return { hook: renderHook(() => useAuthorizedContext(client)), set: (next: AuthorizedContext[]) => { contexts = next; } };
}

it("groups the indicators of one scope into a single selectable group and auto-selects it", async () => {
  const { hook: { result } } = groupedHook(indicators);
  await act(async () => { await result.current.refresh(); });
  expect(result.current.groups.map(({ key }) => key)).toEqual([groupKey]);
  expect(result.current.group?.contexts.map(({ key }) => key)).toEqual(["ind-1", "ind-2"]);
  expect(result.current.context?.key).toBe("ind-1");
});

it("keeps a group valid while discovery still lists every one of its contexts unchanged", async () => {
  const { hook: { result }, set } = groupedHook(indicators);
  await act(async () => { await result.current.refresh(groupKey); });
  const group = result.current.group;
  set([...indicators, { ...first, key: "late", vinculoId: "late", indicadorId: "indicator-3" }]);
  await act(async () => { expect(await result.current.revalidate()).toBe(true); });
  expect(result.current.group).toBe(group);
  expect(result.current.status).toBe("ready");
});

it.each([
  ["revoked", (list: AuthorizedContext[]) => list.slice(0, 1)],
  ["changed", (list: AuthorizedContext[]) => [list[0], { ...list[1], vinculoId: "other-link" }]],
])("drops the whole group when one of its contexts is %s, leaving only what discovery still lists", async (_name, change) => {
  const { hook: { result }, set } = groupedHook(indicators);
  await act(async () => { await result.current.refresh(groupKey); });
  set(change(indicators));
  await act(async () => { expect(await result.current.revalidate({ visible: true })).toBe(false); });
  expect(result.current.group).toBeNull();
  expect(result.current.context).toBeNull();
  expect(result.current.error).toMatch(/não está mais autorizado/);
  expect(result.current.groups.flatMap((group) => group.contexts).map(({ vinculoId }) => vinculoId))
    .toEqual(change(indicators).map(({ vinculoId }) => vinculoId));
});
