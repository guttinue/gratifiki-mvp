import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthorizedContext, CommandContext, CompetenceState, Role } from "../pilot/types";

const roles = new Set<Role>(["area_tecnica", "revisor_tecnico", "cam", "gestor_unidade", "gestor_distrital", "administrador", "lideranca"]);
const competenceStates = new Set<CompetenceState>(["aberta", "em_revisao", "em_consolidacao", "fechada", "invalidada"]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid authorized contexts");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Invalid authorized context field");
  return value;
}

// Older rows may lack `modelo`: academic contexts are then model 2, legacy ones model 1.
function modelo(value: Record<string, unknown>): AuthorizedContext["modelo"] {
  if (value.modelo === undefined) return value.mode === "legacy" ? 1 : 2;
  if (value.modelo !== 1 && value.modelo !== 2 && value.modelo !== 3) throw new Error("Invalid authorized context modelo");
  return value.modelo;
}

function competenceState(value: unknown): CompetenceState {
  if (!competenceStates.has(value as CompetenceState)) throw new Error("Invalid authorized context competence state");
  return value as CompetenceState;
}

export async function loadAuthorizedContexts(client: SupabaseClient): Promise<AuthorizedContext[]> {
  const { data, error } = await client.rpc("get_authorized_contexts");
  if (error) throw error;
  const rows = object(data).contexts;
  if (!Array.isArray(rows)) throw new Error("Invalid authorized contexts");
  const contexts = rows.map((row): AuthorizedContext => {
    const value = object(row);
    if (!roles.has(value.role as Role) || !["legacy", "academic"].includes(value.mode as string)
      || (value.mode === "legacy" && value.role !== "area_tecnica" && value.role !== "cam")) {
      throw new Error("Invalid authorized context role or mode");
    }
    return {
      key: text(value.key), actorId: text(value.actorId), role: value.role as Role,
      vinculoId: text(value.vinculoId), competenciaId: text(value.competenciaId), indicadorId: text(value.indicadorId),
      escopoId: text(value.escopoId), escopoCodigo: text(value.escopoCodigo),
      competenciaCodigo: text(value.competenciaCodigo), mode: value.mode as AuthorizedContext["mode"],
      modelo: modelo(value),
      // Optional for older rows; when present it must be a known state.
      ...(value.competenciaEstado === undefined ? {} : { competenciaEstado: competenceState(value.competenciaEstado) }),
    };
  });
  if (new Set(contexts.map(({ key }) => key)).size !== contexts.length
    || new Set(contexts.map(({ actorId }) => actorId)).size > 1) throw new Error("Ambiguous authorized contexts");
  return contexts;
}

export function toCommandContext(context: AuthorizedContext): CommandContext {
  return { vinculoId: context.vinculoId, competenciaId: context.competenciaId, indicadorId: context.indicadorId };
}
