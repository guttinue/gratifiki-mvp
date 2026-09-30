import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotContext } from "../../lib/types";
import { getAuthClient, getPilotContext, signIn, signOut } from "./auth";

interface AuthScreenProps {
  client?: SupabaseClient;
  onAuthenticated?: (context: PilotContext) => void;
}

export function AuthScreen({ client = getAuthClient(), onAuthenticated }: AuthScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [context, setContext] = useState<PilotContext | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsBusy(true);

    try {
      await signIn(email, password, client);
      const authorizedContext = await getPilotContext(client);

      if (!authorizedContext) {
        await signOut();
        setContext(null);
        setErrorMessage("Esta conta não possui um vínculo autorizado para o piloto.");
        return;
      }

      setContext(authorizedContext);
      onAuthenticated?.(authorizedContext);
      setPassword("");
    } catch {
      setContext(null);
      setPassword("");
      setErrorMessage("Não foi possível entrar. Verifique suas credenciais ou o acesso.");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSignOut() {
    setIsBusy(true);
    setErrorMessage(null);

    try {
      await signOut(client);
      setContext(null);
    } catch {
      setErrorMessage("Não foi possível encerrar a sessão agora.");
    } finally {
      setIsBusy(false);
    }
  }

  if (context) {
    return (
      <main className="app-shell">
        <section aria-label="Área protegida" className="auth-card" role="region">
          <h1>Contexto autorizado</h1>
          <p>Perfil: {context.papel}</p>
          <p>Escopo: {context.escopoCodigo}</p>
          <button disabled={isBusy} onClick={handleSignOut} type="button">
            Sair
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section aria-labelledby="auth-title" className="auth-card">
        <h1 id="auth-title">Ambiente local de demonstração</h1>
        <form onSubmit={handleSubmit}>
          <label>
            E-mail
            <input
              autoComplete="username"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          <label>
            Senha
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>
          {errorMessage && <p role="alert">{errorMessage}</p>}
          <button disabled={isBusy} type="submit">
            {isBusy ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </section>
    </main>
  );
}
