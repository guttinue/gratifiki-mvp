import type { SupabaseClient } from "@supabase/supabase-js";
import type { EntryState, PilotAuditEvent, PilotContext, PilotEntry, ResultMemory } from "../../lib/types";

const PAGE_SIZE = 100;
const AUDIT_ID_BATCH_SIZE = 100;
const SUBMISSION_ACTION = "demo.entry.submitted";
const ENTRY_STATES = new Set<EntryState>(["pendente", "validada", "corrigida", "fechada", "invalidada"]);

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Persisted pilot data has an invalid ${field}`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Persisted pilot data has an invalid ${field}`);
  }
  return value;
}

function readDecimal(value: unknown, field: string): string {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`Persisted pilot data has an invalid ${field}`);
  }

  const decimal = String(value);
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(decimal)) {
    throw new Error(`Persisted pilot data has an invalid ${field}`);
  }
  return decimal;
}

function readState(value: unknown): EntryState {
  if (typeof value !== "string" || !ENTRY_STATES.has(value as EntryState)) {
    throw new Error("Persisted pilot data has an invalid entry state");
  }
  return value as EntryState;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Persisted pilot data has an invalid ${field}`);
  }
  return value;
}

function readResultRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === null || typeof value === "object") {
    return value === null ? [] : [value];
  }
  throw new Error("Persisted pilot data has invalid results");
}

function readResult(value: unknown, entry: Omit<PilotEntry, "results" | "auditEvents" | "submittedAt">): ResultMemory {
  const result = readObject(value, "result");
  const memory = readObject(result.memoria, "result memory");

  return {
    entryId: entry.id,
    resultId: readString(result.id, "result id"),
    competenciaId: entry.competenciaId,
    competenciaCodigo: entry.competenciaCodigo,
    indicadorId: entry.indicadorId,
    indicadorCodigo: entry.indicadorCodigo,
    escopoId: entry.escopoId,
    escopoCodigo: entry.escopoCodigo,
    inputValue: entry.inputValue,
    resultValue: readDecimal(result.valor, "result value"),
    state: entry.state,
    revision: entry.revision,
    operationId: entry.operationId,
    ruleId: readString(result.regra_id, "rule id"),
    ruleVersion: readPositiveInteger(memory.ruleVersion, "rule version"),
    factor: readDecimal(memory.factor, "rule factor"),
  };
}

async function readEntryRows(client: SupabaseClient, context: PilotContext): Promise<unknown[]> {
  const entries: unknown[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("entradas")
      .select("id, competencia_id, indicador_id, escopo_id, valor, estado, revisao, operation_id, resultados(id, regra_id, valor, memoria)")
      .eq("competencia_id", context.competenciaId)
      .eq("indicador_id", context.indicadorId)
      .eq("escopo_id", context.escopoId)
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Persisted entries query returned invalid data");

    entries.push(...(data as unknown[]));
    if (data.length < PAGE_SIZE) return entries;
  }
}

async function readAuditEvents(
  client: SupabaseClient,
  visibleEntryIds: string[],
): Promise<PilotAuditEvent[]> {
  const events: PilotAuditEvent[] = [];

  for (let start = 0; start < visibleEntryIds.length; start += AUDIT_ID_BATCH_SIZE) {
    const entryIds = visibleEntryIds.slice(start, start + AUDIT_ID_BATCH_SIZE);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client
        .from("eventos_auditoria")
        .select("id, recurso_id, recurso_tipo, acao, ocorrido_em")
        .eq("recurso_tipo", "entrada")
        .eq("acao", SUBMISSION_ACTION)
        .in("recurso_id", entryIds)
        .order("ocorrido_em", { ascending: false })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);

      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("Persisted audit query returned invalid data");

      events.push(...(data as unknown[]).flatMap((row) => {
        const event = readObject(row, "audit event");
        if (event.recurso_tipo !== "entrada" || event.acao !== SUBMISSION_ACTION) return [];

        const entryId = readString(event.recurso_id, "audit entry id");
        if (!visibleEntryIds.includes(entryId)) return [];

        const occurredAt = readString(event.ocorrido_em, "audit timestamp");
        if (!Number.isFinite(Date.parse(occurredAt))) {
          throw new Error("Persisted pilot data has an invalid audit timestamp");
        }

        return [{
          id: readString(event.id, "audit event id"),
          entryId,
          action: SUBMISSION_ACTION,
          occurredAt,
        }];
      }));

      if (data.length < PAGE_SIZE) break;
    }
  }

  return events;
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareAuditEvents(left: PilotAuditEvent, right: PilotAuditEvent): number {
  const timeDifference = Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
  return timeDifference || compareIds(left.id, right.id);
}

export async function loadPilotEntries(
  client: SupabaseClient,
  context: PilotContext,
): Promise<PilotEntry[]> {
  const rows = await readEntryRows(client, context);
  const entries: PilotEntry[] = rows.map((row) => {
    const persisted = readObject(row, "entry");
    const id = readString(persisted.id, "entry id");
    const competenciaId = readString(persisted.competencia_id, "competence id");
    const indicadorId = readString(persisted.indicador_id, "indicator id");
    const escopoId = readString(persisted.escopo_id, "scope id");

    if (
      competenciaId !== context.competenciaId ||
      indicadorId !== context.indicadorId ||
      escopoId !== context.escopoId
    ) {
      throw new Error("Persisted entry is outside the authorized pilot context");
    }

    const entry = {
      id,
      competenciaId,
      competenciaCodigo: context.competenciaCodigo,
      indicadorId,
      indicadorCodigo: context.indicadorCodigo,
      escopoId,
      escopoCodigo: context.escopoCodigo,
      inputValue: readDecimal(persisted.valor, "entry value"),
      state: readState(persisted.estado),
      revision: readPositiveInteger(persisted.revisao, "revision"),
      operationId: readString(persisted.operation_id, "operation id"),
    };

    return {
      ...entry,
      results: readResultRows(persisted.resultados).map((result) => readResult(result, entry)),
      auditEvents: [],
      submittedAt: null,
    };
  });

  const entryIds = entries.map(({ id }) => id);
  if (new Set(entryIds).size !== entryIds.length) {
    throw new Error("Persisted entries query returned duplicate ids");
  }
  if (entryIds.length === 0) return [];

  const events = await readAuditEvents(client, entryIds);
  const eventsByEntry = new Map<string, PilotAuditEvent[]>(entryIds.map((id) => [id, []]));
  for (const event of events) {
    eventsByEntry.get(event.entryId)?.push(event);
  }

  for (const entry of entries) {
    const auditEvents = eventsByEntry.get(entry.id) ?? [];
    auditEvents.sort(compareAuditEvents);
    entry.auditEvents = auditEvents;
    entry.submittedAt = auditEvents[0]?.occurredAt ?? null;
  }

  return entries.sort((left, right) => {
    if (left.submittedAt === null) return right.submittedAt === null ? compareIds(left.id, right.id) : 1;
    if (right.submittedAt === null) return -1;
    const timeDifference = Date.parse(right.submittedAt) - Date.parse(left.submittedAt);
    return timeDifference || compareIds(left.id, right.id);
  });
}
