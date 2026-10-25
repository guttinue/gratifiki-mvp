import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizedContext } from "../pilot/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadAuthorizedContexts } from "./contextApi";

export function useAuthorizedContext(client: SupabaseClient): {
  contexts: AuthorizedContext[]; context: AuthorizedContext | null;
  status: "idle" | "loading" | "ready" | "error"; error: string | null;
  refresh: (preferredKey?: string) => Promise<boolean>;
  selectContext: (key: string) => Promise<boolean>; clear: () => void;
} {
  const [state, setState] = useState<{
    contexts: AuthorizedContext[]; context: AuthorizedContext | null;
    status: "idle" | "loading" | "ready" | "error"; error: string | null;
  }>({ contexts: [], context: null, status: "idle", error: null });
  const generation = useRef(0);
  const choices = useRef<AuthorizedContext[]>([]);

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

  const selectContext = useCallback(async (key: string) => {
    if (!choices.current.some((context) => context.key === key)) return false;
    return refresh(key);
  }, [refresh]);

  return { ...state, refresh, selectContext, clear };
}
