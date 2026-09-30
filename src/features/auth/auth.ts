import { createSupabaseClient } from "../../lib/supabase";
import type { PilotContext } from "../../lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

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

export async function getPilotContext(client: SupabaseClient): Promise<PilotContext | null> {
  const { data: userData, error: userError } = await client.auth.getUser();

  if (userError) {
    throw userError;
  }

  const actor = userData.user;

  if (!actor) {
    return null;
  }

  const { data: links, error: linkError } = await client
    .from("vinculos")
    .select("actor_id, papel, escopo_id")
    .eq("actor_id", actor.id)
    .in("papel", ["area_tecnica", "cam"]);

  if (linkError) {
    throw linkError;
  }

  if (links?.length !== 1) {
    return null;
  }

  const link = links[0];

  if (
    link.actor_id !== actor.id ||
    (link.papel !== "area_tecnica" && link.papel !== "cam") ||
    typeof link.escopo_id !== "string"
  ) {
    return null;
  }

  const [scopeResult, competenceResult, indicatorResult] = await Promise.all([
    client.from("escopos").select("id, codigo").eq("id", link.escopo_id).maybeSingle(),
    client
      .from("competencias")
      .select("id, codigo, referencia")
      .eq("codigo", "DEMO-2026-09")
      .maybeSingle(),
    client.from("indicadores").select("id, codigo").eq("codigo", "DEMO-01").maybeSingle(),
  ]);

  if (scopeResult.error) throw scopeResult.error;
  if (competenceResult.error) throw competenceResult.error;
  if (indicatorResult.error) throw indicatorResult.error;

  const scope = scopeResult.data;
  const competence = competenceResult.data;
  const indicator = indicatorResult.data;

  if (!scope || !competence || !indicator) {
    return null;
  }

  return {
    actorId: actor.id,
    papel: link.papel,
    competenciaId: competence.id,
    competenciaCodigo: competence.codigo,
    referencia: competence.referencia,
    indicadorId: indicator.id,
    indicadorCodigo: indicator.codigo,
    escopoId: scope.id,
    escopoCodigo: scope.codigo,
  };
}
