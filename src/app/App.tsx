import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthScreen } from "../features/auth/AuthScreen";
import { getAuthClient, getPilotContext, signOut } from "../features/auth/auth";
import { EntryForm } from "../features/entry/EntryForm";
import { loadPilotEntries } from "../features/entry/pilotReadModel";
import { DashboardPage } from "../features/workspace/DashboardPage";
import { EntriesPage } from "../features/workspace/EntriesPage";
import { HistoryPage } from "../features/workspace/HistoryPage";
import { WorkspaceShell } from "../features/workspace/WorkspaceShell";
import { pageFromHash, pageHash, type WorkspacePage } from "../features/workspace/workspaceModel";
import type { PilotContext, PilotEntry } from "../lib/types";

interface ReadState {
  contextKey: string | null;
  status: "idle" | "loading" | "loaded" | "error";
  entries: PilotEntry[];
  errorMessage?: string;
}

function getContextKey(context: PilotContext | null): string | null {
  if (!context) return null;
  return JSON.stringify([
    context.actorId,
    context.competenciaId,
    context.indicadorId,
    context.escopoId,
    context.papel,
  ]);
}

export function App() {
  const [client] = useState<SupabaseClient>(() => getAuthClient());
  const [context, setContext] = useState<PilotContext | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [readState, setReadState] = useState<ReadState>({ contextKey: null, status: "idle", entries: [] });
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [page, setPage] = useState<WorkspacePage>(() => pageFromHash(window.location.hash));
  const readGeneration = useRef(0);
  const authGeneration = useRef(0);
  const contextKey = getContextKey(context);
  const contextRef = useRef<PilotContext | null>(context);
  const contextKeyRef = useRef(contextKey);
  contextRef.current = context;
  contextKeyRef.current = contextKey;

  useEffect(() => {
    function syncPageFromHash() {
      const nextPage = pageFromHash(window.location.hash);
      if (window.location.hash !== pageHash(nextPage)) {
        window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${pageHash(nextPage)}`);
      }
      setPage(nextPage);
    }

    syncPageFromHash();
    window.addEventListener("hashchange", syncPageFromHash);
    return () => window.removeEventListener("hashchange", syncPageFromHash);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const restoreGeneration = authGeneration.current;
    const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === "SIGNED_OUT" || !session) {
        authGeneration.current += 1;
        readGeneration.current += 1;
        setContext(null);
        setReadState({ contextKey: null, status: "idle", entries: [] });
        setSelectedEntryId(null);
        setSessionError(null);
        setSignOutError(null);
      }
    });

    void (async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          if (isMounted && authGeneration.current === restoreGeneration) setContext(null);
          return;
        }

        const restoredContext = await getPilotContext(client);
        if (isMounted && authGeneration.current === restoreGeneration) {
          setContext(restoredContext);
          if (!restoredContext) {
            setSessionError("Esta sessão não possui um vínculo autorizado para o piloto.");
          }
        }
      } catch {
        if (isMounted && authGeneration.current === restoreGeneration) {
          setContext(null);
          setSessionError("Não foi possível restaurar o acesso local. Entre novamente.");
        }
      } finally {
        if (isMounted) setIsCheckingSession(false);
      }
    })();

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, [client]);

  const refreshEntries = useCallback(async (activeContext: PilotContext) => {
    const activeKey = getContextKey(activeContext);
    const generation = ++readGeneration.current;
    setReadState({ contextKey: activeKey, status: "loading", entries: [] });

    try {
      const loadedEntries = await loadPilotEntries(client, activeContext);
      if (readGeneration.current !== generation || contextKeyRef.current !== activeKey) return;
      setReadState({ contextKey: activeKey, status: "loaded", entries: loadedEntries });
    } catch {
      if (readGeneration.current !== generation || contextKeyRef.current !== activeKey) return;
      setReadState({
        contextKey: activeKey,
        status: "error",
        entries: [],
        errorMessage: "Não foi possível carregar os registros autorizados. Tente atualizar a consulta.",
      });
    }
  }, [client]);

  useEffect(() => {
    if (!context || !contextKey) {
      readGeneration.current += 1;
      setReadState({ contextKey: null, status: "idle", entries: [] });
      setSelectedEntryId(null);
      return;
    }

    void refreshEntries(context);
    return () => {
      readGeneration.current += 1;
    };
  }, [context, contextKey, refreshEntries]);

  const entries = readState.contextKey === contextKey && readState.status === "loaded" ? readState.entries : [];
  const isLoadingEntries = Boolean(contextKey) && (
    readState.contextKey !== contextKey || readState.status === "loading"
  );
  const entriesError = readState.contextKey === contextKey && readState.status === "error"
    ? readState.errorMessage ?? "Não foi possível carregar os registros autorizados."
    : null;

  function handleNavigate(destination: WorkspacePage) {
    const nextHash = pageHash(destination);
    if (window.location.hash !== nextHash) window.location.hash = nextHash;
    setPage(destination);
  }

  async function handleSignOut() {
    if (!context || !contextKey) return;
    const activeContext = context;
    const activeKey = contextKey;
    readGeneration.current += 1;
    setReadState({ contextKey: activeKey, status: "loading", entries: [] });
    setSelectedEntryId(null);
    setIsSigningOut(true);
    setSignOutError(null);

    try {
      await signOut(client);
      readGeneration.current += 1;
      setContext(null);
      setReadState({ contextKey: null, status: "idle", entries: [] });
      setSessionError(null);
    } catch {
      setSignOutError("Não foi possível encerrar a sessão agora. Você pode tentar novamente.");
      if (contextKeyRef.current === activeKey) void refreshEntries(activeContext);
    } finally {
      setIsSigningOut(false);
    }
  }

  function handleAuthenticated(authorizedContext: PilotContext) {
    setSessionError(null);
    setSignOutError(null);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${pageHash("overview")}`);
    setPage("overview");
    setContext(authorizedContext);
  }

  function handleRetry() {
    if (context) void refreshEntries(context);
  }

  function handleSubmitted() {
    const activeContext = contextRef.current;
    if (activeContext) return refreshEntries(activeContext);
  }

  if (isCheckingSession) {
    return (
      <main className="auth-screen">
        <section className="auth-card loading-card" aria-live="polite" role="status">
          <p className="eyebrow">GRATIFIKI · PILOTO LOCAL</p>
          <h1>Preparando o espaço de trabalho</h1>
          <p>Verificando a sessão e o contexto sintético autorizado…</p>
        </section>
      </main>
    );
  }

  if (!context) {
    return (
      <>
        {sessionError && <p className="session-error" role="alert">{sessionError}</p>}
        <AuthScreen client={client} onAuthenticated={handleAuthenticated} />
      </>
    );
  }

  const formKey = getContextKey(context) ?? "no-context";
  const entryForm = context.papel === "area_tecnica"
    ? <EntryForm client={client} context={context} key={formKey} onSubmitted={handleSubmitted} />
    : undefined;

  return (
    <WorkspaceShell
      context={context}
      isSigningOut={isSigningOut}
      onNavigate={handleNavigate}
      onSignOut={handleSignOut}
      page={page}
      signOutError={signOutError}
    >
      {page === "overview" && (
        <DashboardPage
          context={context}
          entries={entries}
          errorMessage={entriesError}
          isLoading={isLoadingEntries}
          onNavigate={handleNavigate}
          onRetry={handleRetry}
        />
      )}
      <div aria-hidden={page !== "entries"} hidden={page !== "entries"}>
        <EntriesPage
          context={context}
          entries={entries}
          entryForm={entryForm}
          errorMessage={entriesError}
          isLoading={isLoadingEntries}
          onRetry={handleRetry}
          onSelectEntry={setSelectedEntryId}
          selectedEntryId={selectedEntryId}
        />
      </div>
      {page === "history" && (
        <HistoryPage
          entries={entries}
          errorMessage={entriesError}
          isLoading={isLoadingEntries}
          onRetry={handleRetry}
          onSelectEntry={setSelectedEntryId}
          selectedEntryId={selectedEntryId}
        />
      )}
    </WorkspaceShell>
  );
}
