import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AuthScreen } from "../features/auth/AuthScreen";
import { getAuthClient, getPilotContext, signOut } from "../features/auth/auth";
import { EntryForm } from "../features/entry/EntryForm";
import { loadDemoHistory } from "../features/entry/entryApi";
import { ResultMemory } from "../features/entry/ResultMemory";
import type { PilotContext, ResultMemory as ResultMemoryRecord } from "../lib/types";

export function App() {
  const [client] = useState<SupabaseClient>(() => getAuthClient());
  const [context, setContext] = useState<PilotContext | null>(null);
  const [history, setHistory] = useState<ResultMemoryRecord[]>([]);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const { data: authListener } = client.auth.onAuthStateChange((event, session) => {
      if (!isMounted) return;
      if (event === "SIGNED_OUT" || !session) {
        setContext(null);
        setHistory([]);
        setHistoryError(null);
      }
    });

    void (async () => {
      try {
        const { data, error } = await client.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          if (isMounted) setContext(null);
          return;
        }

        const restoredContext = await getPilotContext(client);
        if (isMounted) {
          setContext(restoredContext);
          if (!restoredContext) {
            setSessionError("Esta sessão não possui um vínculo autorizado para o piloto.");
          }
        }
      } catch {
        if (isMounted) {
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

  const refreshHistory = useCallback(async (activeContext: PilotContext) => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const records = await loadDemoHistory(client, activeContext);
      setHistory(records);
    } catch {
      setHistoryError("Não foi possível carregar o histórico autorizado. Tente atualizar a consulta.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, [client]);

  useEffect(() => {
    if (!context) {
      setHistory([]);
      return;
    }

    void refreshHistory(context);
  }, [context, refreshHistory]);

  async function handleSignOut() {
    setIsSigningOut(true);
    setSessionError(null);
    try {
      await signOut(client);
      setContext(null);
    } catch {
      setSessionError("Não foi possível encerrar a sessão agora.");
    } finally {
      setIsSigningOut(false);
    }
  }

  async function handleSubmitted() {
    if (context) await refreshHistory(context);
  }

  if (isCheckingSession) {
    return (
      <main className="app-shell">
        <section className="loading-card" aria-live="polite">
          <p className="eyebrow">GRATIFIKI · PILOTO LOCAL</p>
          <h1>Ambiente local de demonstração</h1>
          <p>Verificando a sessão e o contexto sintético autorizado…</p>
        </section>
      </main>
    );
  }

  if (!context) {
    return (
      <>
        {sessionError && <p className="session-error" role="alert">{sessionError}</p>}
        <AuthScreen
          client={client}
          onAuthenticated={(authorizedContext) => {
            setSessionError(null);
            setContext(authorizedContext);
          }}
        />
      </>
    );
  }

  return (
    <main className="app-shell">
      <div className="workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">GRATIFIKI · PILOTO LOCAL</p>
            <h1>Entrada do indicador</h1>
          </div>
          <button className="secondary-button" disabled={isSigningOut} onClick={handleSignOut} type="button">
            {isSigningOut ? "Saindo…" : "Sair"}
          </button>
        </header>

        <aside className="demo-notice">
          <span className="notice-mark" aria-hidden="true">i</span>
          <div>
            <strong>Ambiente local · demonstração sintética</strong>
            <p>Este cenário usa dados fictícios e regra demonstrativa. Não representa cálculo oficial nem validação institucional.</p>
          </div>
        </aside>

        <section aria-label="Contexto autorizado do piloto" className="session-context">
          <div><span>Perfil</span><strong>{context.papel === "area_tecnica" ? "Área técnica" : "CAM"}</strong></div>
          <div><span>Escopo</span><strong>{context.escopoCodigo}</strong></div>
        </section>

        {sessionError && <p className="inline-error" role="alert">{sessionError}</p>}
        {context.papel === "area_tecnica" ? (
          <EntryForm client={client} context={context} onSubmitted={handleSubmitted} />
        ) : (
          <section className="entry-card cam-notice">
            <p className="eyebrow">ACESSO DE LEITURA</p>
            <h2>Acompanhamento do piloto</h2>
            <p>Perfil CAM: esta conta não envia entradas nesta demonstração.</p>
          </section>
        )}

        <ResultMemory errorMessage={historyError} isLoading={isLoadingHistory} items={history} />
      </div>
    </main>
  );
}
