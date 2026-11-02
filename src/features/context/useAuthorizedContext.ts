import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizedContext } from "../pilot/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAuthorizedContexts } from "./contextApi";

// revalidating/unverified keep the selected context so its subtree can stay
// mounted but hidden; the App must never display it in those states.
type Status = "idle" | "loading" | "ready" | "error" | "revalidating" | "unverified";

function sameContext(a: AuthorizedContext, b: AuthorizedContext): boolean {
  return (Object.keys(a) as (keyof AuthorizedContext)[]).every((field) => a[field] === b[field]);
}

export function useAuthorizedContext(client: SupabaseClient): {
  contexts: AuthorizedContext[]; context: AuthorizedContext | null;
  status: Status; error: string | null;
  refresh: (preferredKey?: string) => Promise<boolean>;
  revalidate: (options?: { visible?: boolean }) => Promise<boolean>;
  selectContext: (key: string) => Promise<boolean>; clear: () => void;
} {
  const [state, setState] = useState<{
    contexts: AuthorizedContext[]; context: AuthorizedContext | null;
    status: Status; error: string | null;
  }>({ contexts: [], context: null, status: "idle", error: null });
  const generation = useRef(0);
  const choices = useRef<AuthorizedContext[]>([]);
  const selected = useRef<AuthorizedContext | null>(null);
  selected.current = state.context;

  const clear = useCallback(() => {
    generation.current += 1;
    choices.current = [];
    setState({ contexts: [], context: null, status: "idle", error: null });
  }, []);
  useEffect(() => () => { generation.current += 1; choices.current = []; }, [client]);

  const refresh = useCallback(async (preferredKey?: string) => {
    const request = ++generation.current;
    choices.current = [];
    setState({ contexts: [], context: null, status: "loading", error: null });
    try {
      const contexts = await loadAuthorizedContexts(client);
      if (generation.current !== request) return false;
      choices.current = contexts;
      const context = preferredKey !== undefined
        ? contexts.find(({ key }) => key === preferredKey) ?? null
        : contexts.length === 1 ? contexts[0] : null;
      setState({ contexts, context, status: "ready", error: null });
      return contexts.length > 0;
    } catch {
      if (generation.current !== request) return false;
      setState({ contexts: [], context: null, status: "error", error: "Não foi possível verificar os contextos autorizados." });
      return false;
    }
  }, [client]);

  // Rechecks the selected context without unmounting it. Only a discovery that
  // still lists the identical context reveals it again; absence drops it, and
  // an unknown answer keeps it hidden until a later positive recheck. `visible`
  // skips the hiding while asking (a denied read may be no revocation at all).
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
      choices.current = contexts;
      const still = contexts.find((context) => context.key === current.key);
      if (still && sameContext(still, current)) {
        setState({ contexts, context: current, status: "ready", error: null });
        return true;
      }
      setState({ contexts, context: null, status: "ready", error: "O acesso a este contexto não está mais autorizado. O conteúdo carregado foi descartado." });
      return false;
    } catch {
      if (generation.current !== request) return false;
      setState((previous) => ({ ...previous, status: "unverified", error: "Não foi possível confirmar o acesso a este contexto." }));
      return false;
    }
  }, [client]);

  const selectContext = useCallback(async (key: string) => {
    if (!choices.current.some((context) => context.key === key)) return false;
    return refresh(key);
  }, [refresh]);

  return { ...state, refresh, revalidate, selectContext, clear };
}
