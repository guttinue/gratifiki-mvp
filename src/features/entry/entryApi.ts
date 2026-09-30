import type { SupabaseClient } from "@supabase/supabase-js";
import type { PilotContext, ResultMemory, SubmitResult } from "../../lib/types";

type PersistedResultRow = {
  id: string;
  regra_id: string;
  valor: number;
  memoria: unknown;
};

type PersistedEntryRow = {
  id: string;
  competencia_id: string;
  indicador_id: string;
  escopo_id: string;
  valor: number;
  estado: string;
  revisao: number;
  operation_id: string;
  resultados: PersistedResultRow[] | PersistedResultRow | null;
};

function readPersistedDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`Persisted result memory is missing ${field}`);
  }

  const decimal = String(value);
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(decimal)) {
    throw new Error(`Persisted result memory has an invalid ${field}`);
  }

  return decimal;
}

function readPersistedRuleVersion(memory: Record<string, unknown>): number {
  const version = memory.ruleVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("Persisted result memory has an invalid rule version");
  }

  return version;
}

function readMemoryObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Persisted result memory is unavailable");
  }

  return value as Record<string, unknown>;
}

export async function submitDemoEntry(
  client: SupabaseClient,
  input: {
    competenciaId: string;
    indicadorId: string;
    escopoId: string;
    valueText: string;
    operationId: string;
  },
): Promise<SubmitResult> {
  const { data: authData, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  if (!authData.session?.access_token) {
    throw new Error("demo_session_expired");
  }

  const { data, error } = await client.rpc("submit_demo_entry", {
    p_competencia_id: input.competenciaId,
    p_indicador_id: input.indicadorId,
    p_escopo_id: input.escopoId,
    p_valor_texto: input.valueText,
    p_operation_id: input.operationId,
  });

  if (error) throw error;

  if (
    !data ||
    typeof data !== "object" ||
    typeof data.entryId !== "string" ||
    typeof data.resultId !== "string" ||
    typeof data.resultValue !== "string" ||
    typeof data.ruleVersion !== "number" ||
    typeof data.operationId !== "string"
  ) {
    throw new Error("The server returned an invalid persisted entry response");
  }

  return data as SubmitResult;
}

export async function loadDemoHistory(
  client: SupabaseClient,
  context: PilotContext,
): Promise<ResultMemory[]> {
  const { data, error } = await client
    .from("entradas")
    .select(
      "id, competencia_id, indicador_id, escopo_id, valor, estado, revisao, operation_id, resultados(id, regra_id, valor, memoria)",
    )
    .eq("competencia_id", context.competenciaId)
    .eq("indicador_id", context.indicadorId)
    .eq("escopo_id", context.escopoId);

  if (error) throw error;

  return ((data ?? []) as unknown as PersistedEntryRow[]).flatMap((entry) => {
    const resultRows = Array.isArray(entry.resultados)
      ? entry.resultados
      : entry.resultados
        ? [entry.resultados]
        : [];

    return resultRows.map((result) => {
      const memory = readMemoryObject(result.memoria);

      return {
        entryId: entry.id,
        resultId: result.id,
        competenciaId: entry.competencia_id,
        competenciaCodigo: context.competenciaCodigo,
        indicadorId: entry.indicador_id,
        indicadorCodigo: context.indicadorCodigo,
        escopoId: entry.escopo_id,
        escopoCodigo: context.escopoCodigo,
        inputValue: readPersistedDecimal(entry.valor, "entry value"),
        resultValue: readPersistedDecimal(result.valor, "result value"),
        state: entry.estado as ResultMemory["state"],
        revision: entry.revisao,
        operationId: entry.operation_id,
        ruleId: result.regra_id,
        ruleVersion: readPersistedRuleVersion(memory),
        factor: readPersistedDecimal(memory.factor, "rule factor"),
      };
    });
  });
}

export function formatDemoDecimal(value: string): string {
  const [integer, fraction] = value.split(".");
  const normalizedFraction = fraction?.replace(/0+$/, "");
  return normalizedFraction ? `${integer},${normalizedFraction}` : integer;
}

export function entryErrorMessage(error: unknown): string {
  const details =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown; status?: unknown })
      : {};
  const code = typeof details.code === "string" ? details.code : "";
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";
  const status = typeof details.status === "number" ? details.status : undefined;

  if (message.includes("operation_id_payload_mismatch")) {
    return "O servidor encontrou uma operação anterior com outro valor. A tentativa preservada foi mantida bloqueada para reconciliação; não edite nem inicie outra entrada.";
  }

  if (
    message.includes("session_expired") ||
    message.includes("jwt expired") ||
    code === "PGRST301" ||
    status === 401
  ) {
    return "Sua sessão expirou. Entre novamente antes de registrar uma entrada.";
  }

  if (code === "22023" || message.includes("invalid_demo_value")) {
    return "O servidor rejeitou o valor. Informe um número não negativo.";
  }

  if (code === "42501" || status === 403) {
    return "Sua sessão não tem permissão para registrar esta entrada.";
  }

  return "Não foi possível confirmar a resposta do servidor. Tente novamente; o próximo envio repetirá a mesma operação.";
}

export function isUncertainEntryError(error: unknown): boolean {
  const details =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown; message?: unknown; status?: unknown })
      : {};
  const code = typeof details.code === "string" ? details.code : "";
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";
  const status = typeof details.status === "number" ? details.status : undefined;

  if (message.includes("operation_id_payload_mismatch")) return true;

  if (
    message.includes("session_expired") ||
    message.includes("jwt expired") ||
    message.includes("invalid_demo_value") ||
    message.includes("operation_id_required") ||
    message.includes("demo_context_required") ||
    code === "PGRST301" ||
    code === "42501" ||
    status === 401 ||
    status === 403
  ) {
    return false;
  }

  if (code === "22023") return true;

  return status === undefined || status <= 0 || status >= 500;
}

export function isDefinitelyRejectedEntry(error: unknown): boolean {
  const details =
    typeof error === "object" && error !== null
      ? (error as { message?: unknown })
      : {};
  const message = typeof details.message === "string" ? details.message.toLowerCase() : "";

  return (
    message.includes("invalid_demo_value") ||
    message.includes("operation_id_required") ||
    message.includes("demo_context_required")
  );
}
