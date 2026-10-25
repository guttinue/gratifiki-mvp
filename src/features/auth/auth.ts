import { createSupabaseClient } from "../../lib/supabase";
import type { PilotContext } from "../../lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAuthorizedContexts } from "../context/contextApi";

let authClient: SupabaseClient | undefined;

export function getAuthClient(): SupabaseClient {
  authClient ??= createSupabaseClient();
  return authClient;
}

export async function signIn(
  email: string,
  password: string,
  client: SupabaseClient = getAuthClient(),
): Promise<void> {
  const { error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    throw error;
  }
}

export async function signOut(client: SupabaseClient = getAuthClient()): Promise<void> {
  const { error } = await client.auth.signOut();

  if (error) {
    throw error;
  }
}

// Compatibility adapter only. Academic commands never consume PilotContext.
export async function getPilotContext(client: SupabaseClient, selectedKey?: string): Promise<PilotContext | null> {
  const { data: userData, error: userError } = await client.auth.getUser();

  if (userError) {
    throw userError;
  }

  const actor = userData.user;

  if (!actor) {
    return null;
  }

  const contexts = await loadAuthorizedContexts(client);
  const context = selectedKey === undefined
    ? contexts.length === 1 ? contexts[0] : null
    : contexts.find(({ key }) => key === selectedKey);
  if (!context || context.mode !== "legacy" || context.actorId !== actor.id
    || (context.role !== "area_tecnica" && context.role !== "cam")) return null;

  const [competenceResult, indicatorResult] = await Promise.all([
    client.from("competencias").select("id, referencia").eq("id", context.competenciaId).maybeSingle(),
    client.from("indicadores").select("id, codigo").eq("id", context.indicadorId).maybeSingle(),
  ]);

  if (competenceResult.error) throw competenceResult.error;
  if (indicatorResult.error) throw indicatorResult.error;

  const competence = competenceResult.data;
  const indicator = indicatorResult.data;

  if (!competence || !indicator) {
    return null;
  }

  return {
    actorId: actor.id,
    papel: context.role,
    competenciaId: competence.id,
    competenciaCodigo: context.competenciaCodigo,
    referencia: competence.referencia,
    indicadorId: indicator.id,
    indicadorCodigo: indicator.codigo,
    escopoId: context.escopoId,
    escopoCodigo: context.escopoCodigo,
  };
}
