import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizedContext, ContextGroup } from "../pilot/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAuthorizedContexts } from "./contextApi";
import { groupContexts } from "./contextGroups";

// revalidating/unverified keep the selected context so its subtree can stay
// mounted but hidden; the App must never display it in those states.
type Status = "idle" | "loading" | "ready" | "error" | "revalidating" | "unverified";

function sameContext(a: AuthorizedContext, b: AuthorizedContext): boolean {
  return (Object.keys(a) as (keyof AuthorizedContext)[]).every((field) => a[field] === b[field]);
}

// The selection is a group (role + competence + scope). `context` is the
// group's first context, for the screens that still work on a single one.
export function useAuthorizedContext(client: SupabaseClient): {
  contexts: AuthorizedContext[]; groups: ContextGroup[]; group: ContextGroup | null;
  context: AuthorizedContext | null; status: Status; error: string | null;
  refresh: (preferredKey?: string) => Promise<boolean>;
  revalidate: (options?: { visible?: boolean }) => Promise<boolean>;
  selectContext: (key: string) => Promise<boolean>; clear: () => void;
} {
  const [state, setState] = useState<{
    contexts: AuthorizedContext[]; groups: ContextGroup[]; group: ContextGroup | null;
    status: Status; error: string | null;
  }>({ contexts: [], groups: [], group: null, status: "idle", error: null });
  const generation = useRef(0);
  const choices = useRef<ContextGroup[]>([]);
  const selected = useRef<ContextGroup | null>(null);
  selected.current = state.group;

  const clear = useCallback(() => {
    generation.current += 1;
    choices.current = [];
    setState({ contexts: [], groups: [], group: null, status: "idle", error: null });
  }, []);
  useEffect(() => () => { generation.current += 1; choices.current = []; }, [client]);

  const refresh = useCallback(async (preferredKey?: string) => {
    const request = ++generation.current;
    choices.current = [];
    setState({ contexts: [], groups: [], group: null, status: "loading", error: null });
    try {
      const contexts = await loadAuthorizedContexts(client);
      if (generation.current !== request) return false;
      const groups = groupContexts(contexts);
      choices.current = groups;
      const group = preferredKey !== undefined
        ? groups.find(({ key }) => key === preferredKey) ?? null
        : groups.length === 1 ? groups[0] : null;
      setState({ contexts, groups, group, status: "ready", error: null });
      return contexts.length > 0;
    } catch {
      if (generation.current !== request) return false;
      setState({ contexts: [], groups: [], group: null, status: "error", error: "Não foi possível verificar os contextos autorizados." });
      return false;
    }
  }, [client]);

  // Rechecks the selected group without unmounting it. Only a discovery that
  // still lists every context of the group, unchanged, reveals it again. If any
  // one of them is gone or changed the whole group is dropped, so nothing from a
  // revoked context stays on screen (the narrowed group is offered again by the
  // picker). An unknown answer keeps it hidden until a later positive recheck.
  // `visible` skips the hiding while asking (a denied read may be no revocation).
  const revalidate = useCallback(async ({ visible = false }: { visible?: boolean } = {}) => {
    const current = selected.current;
    if (!current) return false;
    const request = ++generation.current;
    if (!visible) setState((previous) => ({ ...previous, status: "revalidating", error: null }));
    // Hidden synchronously; discovery starts after the caller's turn, so it is
    // never awaited inside a Supabase auth callback and a same-turn logout wins.
    await Promise.resolve();
    if (generation.current !== request) return false;
    try {
      const contexts = await loadAuthorizedContexts(client);
      if (generation.current !== request) return false;
      const groups = groupContexts(contexts);
      choices.current = groups;
      if (current.contexts.every((context) => contexts.some((listed) => sameContext(listed, context)))) {
        setState({ contexts, groups, group: current, status: "ready", error: null });
        return true;
      }
      setState({ contexts, groups, group: null, status: "ready", error: "O acesso a este contexto não está mais autorizado. O conteúdo carregado foi descartado." });
      return false;
    } catch {
      if (generation.current !== request) return false;
      setState((previous) => ({ ...previous, status: "unverified", error: "Não foi possível confirmar o acesso a este contexto." }));
      return false;
    }
  }, [client]);

  const selectContext = useCallback(async (key: string) => {
    if (!choices.current.some((group) => group.key === key)) return false;
    return refresh(key);
  }, [refresh]);

  return { ...state, context: state.group?.contexts[0] ?? null, refresh, revalidate, selectContext, clear };
}
