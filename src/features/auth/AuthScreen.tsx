import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotContext } from "../../lib/types";
import { getAuthClient, getPilotContext, signIn, signOut } from "./auth";

interface AuthScreenProps {
  client?: SupabaseClient;
  onAuthenticationStarted?: () => number;
  onAuthenticationContextLoading?: (signOutGeneration: number) => number | null;
  isAuthenticationGenerationCurrent?: (generation: number) => boolean;
  onAuthenticated?: (
    context: PilotContext,
    generation: number | undefined,
    isAttemptCurrent: () => boolean,
  ) => boolean | void | Promise<boolean | void>;
}

export function AuthScreen({
  client = getAuthClient(),
  onAuthenticationStarted,
  onAuthenticationContextLoading,
  isAuthenticationGenerationCurrent,
  onAuthenticated,
}: AuthScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [context, setContext] = useState<PilotContext | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const mounted = useRef(true);
  const attemptGeneration = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attemptGeneration.current += 1;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const attemptId = ++attemptGeneration.current;
    const isAttemptCurrent = () => mounted.current && attemptGeneration.current === attemptId;
    const signOutGeneration = onAuthenticationStarted?.();
    setErrorMessage(null);
    setIsBusy(true);

    try {
      await signIn(email, password, client);
      if (!isAttemptCurrent()) return;

      const generation = onAuthenticationContextLoading
        ? onAuthenticationContextLoading(signOutGeneration ?? 0)
        : undefined;
      if (generation === null) {
        setErrorMessage("A sessão mudou durante o acesso. Entre novamente.");
        return;
      }

      const authorizedContext = await getPilotContext(client);
      if (!isAttemptCurrent()) return;

      if (!authorizedContext) {
        if (
          generation !== undefined
          && isAuthenticationGenerationCurrent
          && !isAuthenticationGenerationCurrent(generation)
        ) {
          setErrorMessage("A sessão mudou durante o acesso. Entre novamente.");
          return;
        }
        await signOut(client);
        if (!isAttemptCurrent()) return;
        setContext(null);
        setErrorMessage("Esta conta não possui um vínculo autorizado para o piloto.");
        return;
      }

      const accepted = await onAuthenticated?.(authorizedContext, generation ?? undefined, isAttemptCurrent);
      if (!isAttemptCurrent()) return;
      if (accepted === false) {
        setContext(null);
        setErrorMessage("A sessão mudou durante o acesso. Entre novamente.");
        return;
      }

      setContext(authorizedContext);
      setPassword("");
    } catch {
      if (isAttemptCurrent()) {
        setContext(null);
        setPassword("");
        setErrorMessage("Não foi possível entrar. Verifique suas credenciais ou o acesso.");
      }
    } finally {
      if (isAttemptCurrent()) setIsBusy(false);
    }
  }

  async function handleSignOut() {
    setIsBusy(true);
    setErrorMessage(null);

    try {
      await signOut(client);
      if (!mounted.current) return;
      setContext(null);
    } catch {
      if (mounted.current) setErrorMessage("Não foi possível encerrar a sessão agora.");
    } finally {
      if (mounted.current) setIsBusy(false);
    }
  }

  if (context) {
    return (
      <main className="auth-screen">
        <a className="auth-brand" href="#overview"><span aria-hidden="true" className="brand-mark">g</span>gratifiki</a>
        <section aria-label="Área protegida" className="auth-card" role="region">
          <p className="eyebrow">PILOTO LOCAL</p>
          <h1>Contexto autorizado</h1>
          <p>Perfil: {context.papel}</p>
          <p>Escopo: {context.escopoCodigo}</p>
          <button className="primary-button" disabled={isBusy} onClick={handleSignOut} type="button">
            Sair
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-screen">
      <a className="auth-brand" href="#overview"><span aria-hidden="true" className="brand-mark">g</span>gratifiki</a>
      <section aria-labelledby="auth-title" className="auth-card">
        <p className="eyebrow">ACESSO AO ESPAÇO DE TRABALHO</p>
        <h1 id="auth-title">Acesse o piloto local</h1>
        <p className="auth-intro">Entre com sua conta autorizada para consultar o contexto sintético do piloto.</p>
        <aside className="auth-demo-note">
          <span aria-hidden="true">i</span>
          <p><strong>Demonstração local</strong><span>Dados sintéticos e regra de demonstração. Nenhuma credencial fictícia é fornecida aqui.</span></p>
        </aside>
        <form onSubmit={handleSubmit}>
          <label htmlFor="auth-email">
            E-mail
            <input
              autoComplete="username"
              id="auth-email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label htmlFor="auth-password">
            Senha
            <input
              autoComplete="current-password"
              id="auth-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {errorMessage && <p role="alert">{errorMessage}</p>}
          <button className="primary-button" disabled={isBusy} type="submit">
            {isBusy ? "Entrando…" : "Entrar"}
          </button>
        </form>
        <p className="auth-footnote">Seu perfil e escopo são definidos pelo vínculo autorizado da sessão.</p>
      </section>
    </main>
  );
}
