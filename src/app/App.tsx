import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useAuthorizedContext } from "../features/context/useAuthorizedContext";
import { ContextPicker } from "../features/context/ContextPicker";
import { withAccessDeniedSignal } from "../features/context/accessSignal";
import { AcademicLoadBoundary } from '../features/workspace/AcademicLoadBoundary';
import { requestAcademicLeave } from '../features/workspace/academicNavigation';

const AcademicWorkspace = lazy(() => import('../features/workspace/AcademicWorkspace').then(module => ({ default: module.AcademicWorkspace })));

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
  const authorized = useAuthorizedContext(client);
  const { refresh: refreshContexts, clear: clearContexts, revalidate: revalidateContext } = authorized;
  // Live academic selection (unlike the intent ref below, cleared with it).
  const academicKeyRef = useRef<string | null>(null);
  academicKeyRef.current = authorized.context?.mode === "academic" ? authorized.context.key : null;
  // An explicit denial from any context-bound read or command rechecks the
  // selection; only discovery decides whether it was revoked. A denial may be
  // an out-of-scope read, so the workspace stays visible while asking.
  const handleAccessDenied = useCallback(() => {
    if (academicKeyRef.current) void revalidateContext({ visible: true });
  }, [revalidateContext]);
  const academicClient = useMemo(() => withAccessDeniedSignal(client, handleAccessDenied), [client, handleAccessDenied]);
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
  const signOutGeneration = useRef(0);
  const authActorId = useRef<string | null>(null);
  const contextKey = getContextKey(context);
  const contextRef = useRef<PilotContext | null>(context);
  const contextKeyRef = useRef(contextKey);
  const authorizedContextRef = useRef(authorized.context);
  contextRef.current = context;
  contextKeyRef.current = contextKey;
  // Selection intent survives revalidation's temporary null state. This ref
  // only supplies a preferred key, never authorization or data visibility.
  if (authorized.context) authorizedContextRef.current = authorized.context;
  const sessionGeneration = authGeneration.current;

  useEffect(() => {
    function syncPageFromHash() {
      if(window.location.hash.startsWith('#academico/'))return;
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
        signOutGeneration.current += 1;
        authActorId.current = null;
        authorizedContextRef.current = null;
        readGeneration.current += 1;
        clearContexts();
        setContext(null);
        setReadState({ contextKey: null, status: "idle", entries: [] });
        setSelectedEntryId(null);
        setSessionError(null);
        setSignOutError(null);
        setIsSigningOut(false);
        return;
      }

      const nextActorId = session.user.id;
      const selectedKey = authorizedContextRef.current?.actorId === nextActorId
        ? authorizedContextRef.current.key : undefined;
      const previousActorId = authActorId.current;
      const activeActorId = contextRef.current?.actorId;
      if (
        (previousActorId !== null && previousActorId !== nextActorId)
        || (activeActorId !== undefined && activeActorId !== nextActorId)
      ) {
        authGeneration.current += 1;
        authorizedContextRef.current = null;
        readGeneration.current += 1;
        clearContexts();
        setContext(null);
        setReadState({ contextKey: null, status: "idle", entries: [] });
        setSelectedEntryId(null);
        setSessionError(null);
        setSignOutError(null);
        setIsSigningOut(false);
      }
      authActorId.current = nextActorId;
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        authGeneration.current += 1;
        const refreshGeneration = authGeneration.current;
        setIsSigningOut(false);
        if (academicKeyRef.current) {
          // Same actor: keep the academic subtree (and its unsaved edits)
          // mounted but hidden until discovery confirms the same context.
          void revalidateContext();
          return;
        }
        readGeneration.current += 1;
        clearContexts();
        setContext(null);
        setReadState({ contextKey: null, status: "idle", entries: [] });
        setSelectedEntryId(null);
        // Do not await Supabase operations inside its auth callback.
        queueMicrotask(() => {
          if (isMounted && authGeneration.current === refreshGeneration && authActorId.current === nextActorId) void refreshContexts(selectedKey);
        });
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

        if (!isMounted || authGeneration.current !== restoreGeneration) return;

        authActorId.current = data.session.user.id;
        const hasContexts = await refreshContexts();
        if (isMounted && authGeneration.current === restoreGeneration) {
          if (!hasContexts) {
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
  }, [client, clearContexts, refreshContexts, revalidateContext]);

  // The old workspace can consume only legacy contexts. Selection changes
  // synchronously hide it; the generation guard also rejects late adapters.
  useEffect(() => {
    let current = true;
    const generation = authGeneration.current;
    readGeneration.current += 1;
    setContext(null);
    setReadState({ contextKey: null, status: "idle", entries: [] });
    setSelectedEntryId(null);
    if (authorized.context?.mode === "legacy") {
      void getPilotContext(client, authorized.context.key).then((legacy) => {
        if (!current || authGeneration.current !== generation) return;
        if (legacy?.actorId === authActorId.current) setContext(legacy);
        else {
          clearContexts();
          setSessionError("Este contexto não está mais autorizado. Entre novamente.");
        }
      }).catch(() => {
        if (current && authGeneration.current === generation) {
          clearContexts();
          setSessionError("Não foi possível verificar o contexto legado.");
        }
      });
    }
    return () => { current = false; readGeneration.current += 1; };
  }, [client, authorized.context, clearContexts, sessionGeneration]);

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
    authGeneration.current += 1;
    signOutGeneration.current += 1;
    const requestGeneration = authGeneration.current;
    const requestSignOutGeneration = signOutGeneration.current;
    const actorId = authActorId.current;
    const isCurrent = () => authGeneration.current === requestGeneration
      && signOutGeneration.current === requestSignOutGeneration && authActorId.current === actorId;
    readGeneration.current += 1;
    const selectedKey = authorizedContextRef.current?.key;
    clearContexts();
    setContext(null);
    setReadState({ contextKey: null, status: "idle", entries: [] });
    setSelectedEntryId(null);
    setIsSigningOut(true);
    setSignOutError(null);

    try {
      await signOut(client);
      if (!isCurrent()) return;
      authorizedContextRef.current = null;
      readGeneration.current += 1;
      setContext(null);
      setReadState({ contextKey: null, status: "idle", entries: [] });
      setSessionError(null);
    } catch {
      if (!isCurrent()) return;
      setSignOutError("Não foi possível encerrar a sessão agora. Você pode tentar novamente.");
      // Recovery is also a generation-owned request; a new login clears the
      // context hook before starting, invalidating any late recovery response.
      await refreshContexts(selectedKey);
    } finally {
      if (isCurrent()) setIsSigningOut(false);
    }
  }

  function beginAuthentication(): number {
    authGeneration.current += 1;
    signOutGeneration.current += 1;
    readGeneration.current += 1;
    authorizedContextRef.current = null;
    clearContexts();
    setContext(null);
    setReadState({ contextKey: null, status: "idle", entries: [] });
    setSelectedEntryId(null);
    setIsSigningOut(false);
    setSignOutError(null);
    return signOutGeneration.current;
  }

  function getAuthenticationGenerationAfterSignIn(startedSignOutGeneration: number): number | null {
    if (signOutGeneration.current !== startedSignOutGeneration) return null;
    return authGeneration.current;
  }

  function isAuthenticationGenerationCurrent(generation: number): boolean {
    return authGeneration.current === generation;
  }

  async function handleAuthenticated(
    generation: number | undefined,
    isAttemptCurrent: () => boolean,
  ): Promise<boolean> {
    if (
      generation === undefined
      || !isAttemptCurrent()
      || authGeneration.current !== generation
    ) return false;

    try {
      const { data, error } = await client.auth.getSession();
      if (
        error
        || !data.session
        || !isAttemptCurrent()
        || authGeneration.current !== generation
      ) return false;
      authActorId.current = data.session.user.id;
    } catch {
      return false;
    }

    setSessionError(null);
    setSignOutError(null);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}${pageHash("overview")}`);
    setPage("overview");
    return refreshContexts();
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

  const choices = <ContextPicker contexts={authorized.contexts} selectedKey={authorized.context?.key ?? null}
    onSelect={(key) => {
      if(key===authorized.context?.key||!requestAcademicLeave())return;
      const candidate = authorized.contexts.find((choice) => choice.key === key);
      if (candidate) authorizedContextRef.current = candidate;
      void authorized.selectContext(key);
    }} />;

  if (authorized.status === "loading" || (authorized.context?.mode === "legacy" && !context && !sessionError)) {
    return <main className="auth-screen"><section className="auth-card" role="status">Verificando contexto autorizado…</section></main>;
  }

  if (authorized.context?.mode === 'academic') {
    // The wrapper keeps one tree position, so hiding never remounts the
    // workspace; `hidden` removes it from display and the accessibility tree.
    const verifying = authorized.status === "revalidating" || authorized.status === "unverified";
    return <>
      {verifying && <main className="auth-screen"><section className="auth-card">
        {authorized.status === "revalidating"
          ? <p role="status">Verificando o acesso a este contexto…</p>
          : <><p role="alert">{authorized.error}</p>
            <button type="button" onClick={() => void revalidateContext()}>Verificar acesso novamente</button></>}
        <button type="button" disabled={isSigningOut} onClick={handleSignOut}>Sair</button>
      </section></main>}
      <div hidden={verifying}><AcademicLoadBoundary key={authorized.context.key}><Suspense fallback={<main className="auth-screen"><section className="auth-card" role="status">Carregando espaço acadêmico…</section></main>}>
        <AcademicWorkspace client={academicClient} context={authorized.context} contextPicker={choices}
          onSignOut={handleSignOut} isSigningOut={isSigningOut} signOutError={signOutError} />
      </Suspense></AcademicLoadBoundary></div>
    </>;
  }

  if (!authorized.context && authorized.contexts.length > 0) {
    return <main className="auth-screen"><section className="auth-card">
      <h1>Selecione seu contexto</h1>
      {authorized.error && <p role="alert">{authorized.error}</p>}
      {choices}
      {signOutError && <p role="alert">{signOutError}</p>}
      <button type="button" disabled={isSigningOut} onClick={handleSignOut}>Sair</button>
    </section></main>;
  }

  if (!context || !authorized.context) {
    return (
      <>
        {sessionError && <p className="session-error" role="alert">{sessionError}</p>}
        {(authorized.error || (authorized.status === "ready" && authorized.contexts.length === 0 && !sessionError)) &&
          <p role="alert">{authorized.error ?? "Esta sessão não possui um vínculo autorizado para o piloto."}</p>}
        <AuthScreen
          client={client}
          isAuthenticationGenerationCurrent={isAuthenticationGenerationCurrent}
          onAuthenticationContextLoading={getAuthenticationGenerationAfterSignIn}
          onAuthenticationStarted={beginAuthentication}
          onSessionAuthenticated={handleAuthenticated}
        />
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
      <aside aria-label="Leitura histórica legada"><strong>Baseline legada</strong><p>Registros históricos: pendente não significa aprovação. Este espaço não executa o ciclo acadêmico atual.</p></aside>
      {authorized.contexts.length > 1 && choices}
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
