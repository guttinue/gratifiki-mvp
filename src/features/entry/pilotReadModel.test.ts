import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { PilotContext } from "../../lib/types";
import { loadPilotEntries } from "./pilotReadModel";

const context: PilotContext = {
  actorId: "actor-1",
  papel: "cam",
  competenciaId: "competencia-1",
  competenciaCodigo: "DEMO-2026-09",
  referencia: "2026-09-15",
  indicadorId: "indicador-1",
  indicadorCodigo: "DEMO-01",
  escopoId: "escopo-1",
  escopoCodigo: "DEMO-ESCOPO-01",
};

type EntryFixture = {
  id: string;
  competencia_id: string;
  indicador_id: string;
  escopo_id: string;
  valor: string | number;
  estado: string;
  revisao: number;
  operation_id: string;
  resultados: Array<{
    id: string;
    regra_id: string;
    valor: string | number;
    factor: string | number;
    memoria: unknown;
  }> | null;
};

type AuditFixture = {
  id: string;
  recurso_id: string;
  recurso_tipo: string;
  acao: string;
  ocorrido_em: string;
};

type QueryRecord = {
  table: string;
  selection: string;
  equals: Array<[string, string]>;
  included: Array<[string, string[]]>;
  ranges: Array<[number, number]>;
  orders: Array<[string, boolean]>;
};

type QueryResponse = { data: unknown[] | null; error: unknown | null };

function createClient(options: {
  entries?: EntryFixture[];
  events?: AuditFixture[];
  entryError?: unknown;
  eventError?: unknown;
}) {
  const records: QueryRecord[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const record: QueryRecord = {
        table,
        selection: "",
        equals: [],
        included: [],
        ranges: [],
        orders: [],
      };
      records.push(record);

      const query = {
        select(selection: string) {
          record.selection = selection;
          return query;
        },
        eq(column: string, value: string) {
          record.equals.push([column, value]);
          return query;
        },
        in(column: string, values: string[]) {
          record.included.push([column, values]);
          return query;
        },
        order(column: string, options: { ascending: boolean }) {
          record.orders.push([column, options.ascending]);
          return query;
        },
        range(start: number, end: number) {
          record.ranges.push([start, end]);
          return query;
        },
        then<TResult1 = QueryResponse, TResult2 = never>(
          onfulfilled?: ((value: QueryResponse) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          const error = table === "entradas" ? options.entryError : options.eventError;
          let data: unknown[] = table === "entradas" ? (options.entries ?? []) : (options.events ?? []);

          if (table === "entradas") {
            for (const [column, value] of record.equals) {
              const field = column as keyof EntryFixture;
              data = data.filter((row) => (row as EntryFixture)[field] === value);
            }
          } else {
            for (const [column, value] of record.equals) {
              const field = column as keyof AuditFixture;
              data = data.filter((row) => (row as AuditFixture)[field] === value);
            }
            for (const [column, values] of record.included) {
              const field = column as keyof AuditFixture;
              data = data.filter((row) => values.includes(String((row as AuditFixture)[field])));
            }
          }

          if (record.ranges.length > 0) {
            for (const [column, ascending] of [...record.orders].reverse()) {
              const compare = (left: unknown, right: unknown) => {
                const leftValue = String((left as Record<string, unknown>)[column]);
                const rightValue = String((right as Record<string, unknown>)[column]);
                return leftValue.localeCompare(rightValue) * (ascending ? 1 : -1);
              };
              data = [...data].sort(compare);
            }
            const [start, end] = record.ranges.at(-1)!;
            data = data.slice(start, end + 1);
          }

          return Promise.resolve({ data: error ? null : data, error: error ?? null }).then(
            onfulfilled,
            onrejected,
          );
        },
      };

      return query;
    }),
  };

  return { client: client as unknown as SupabaseClient, records };
}

function entryFixture(overrides: Partial<EntryFixture> = {}): EntryFixture {
  return {
    id: "entry-1",
    competencia_id: context.competenciaId,
    indicador_id: context.indicadorId,
    escopo_id: context.escopoId,
    valor: "10.1200",
    estado: "pendente",
    revisao: 1,
    operation_id: "operation-1",
    resultados: [],
    ...overrides,
  };
}

function resultFixture(id: string, value: string): NonNullable<EntryFixture["resultados"]>[number] {
  return {
    id,
    regra_id: `rule-${id}`,
    valor: value,
    factor: "0.800000",
    memoria: { factor: 0.8, ruleVersion: 2 },
  };
}

function auditFixture(overrides: Partial<AuditFixture> = {}): AuditFixture {
  return {
    id: "audit-1",
    recurso_id: "entry-1",
    recurso_tipo: "entrada",
    acao: "demo.entry.submitted",
    ocorrido_em: "2026-09-20T15:00:00.000Z",
    ...overrides,
  };
}

describe("loadPilotEntries", () => {
  it("keeps entries without results and attaches multiple precise results and allowed audit events", async () => {
    const entries = [
      entryFixture({ id: "entry-empty", valor: "0.0001", operation_id: "op-empty", resultados: [] }),
      entryFixture({
        id: "entry-many",
        valor: "00010.1200",
        operation_id: "op-many",
        resultados: [resultFixture("result-a", "8.096000"), resultFixture("result-b", "7.00001")],
      }),
    ];
    const events = [
      auditFixture({ id: "audit-many", recurso_id: "entry-many", ocorrido_em: "2026-09-21T15:00:00.000Z" }),
      auditFixture({ id: "audit-hidden", recurso_id: "another-entry" }),
      auditFixture({ id: "audit-wrong-type", recurso_tipo: "perfil" }),
      auditFixture({ id: "audit-wrong-action", acao: "other.action" }),
    ];
    const { client, records } = createClient({ entries, events });

    const result = await loadPilotEntries(client, context);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: "entry-many",
      competenciaCodigo: context.competenciaCodigo,
      indicadorCodigo: context.indicadorCodigo,
      escopoCodigo: context.escopoCodigo,
      inputValue: "00010.1200",
      state: "pendente",
      revision: 1,
      operationId: "op-many",
      submittedAt: "2026-09-21T15:00:00.000Z",
      auditEvents: [{
        id: "audit-many",
        entryId: "entry-many",
        action: "demo.entry.submitted",
        occurredAt: "2026-09-21T15:00:00.000Z",
      }],
    });
    expect(result[0].results).toHaveLength(2);
    expect(result[0].results.map(({ resultValue, factor }) => [resultValue, factor])).toEqual([
      ["8.096000", "0.800000"],
      ["7.00001", "0.800000"],
    ]);
    expect(result[1]).toMatchObject({ id: "entry-empty", results: [], auditEvents: [], submittedAt: null });

    const entryQuery = records.find((query) => query.table === "entradas");
    expect(entryQuery?.selection).toBe(
      "id, competencia_id, indicador_id, escopo_id, valor::text, estado, revisao, operation_id, resultados(id, regra_id, valor::text, memoria, factor:memoria->>factor)",
    );
    expect(entryQuery?.equals).toEqual([
      ["competencia_id", context.competenciaId],
      ["indicador_id", context.indicadorId],
      ["escopo_id", context.escopoId],
    ]);
    const auditQuery = records.find((query) => query.table === "eventos_auditoria");
    expect(auditQuery?.equals).toEqual([
      ["recurso_tipo", "entrada"],
      ["acao", "demo.entry.submitted"],
    ]);
    expect(auditQuery?.included).toEqual([["recurso_id", ["entry-empty", "entry-many"]]]);
    expect(result.flatMap(({ auditEvents }) => auditEvents.map(({ id }) => id))).toEqual(["audit-many"]);
  });

  it("does not query audit events when no entries are visible", async () => {
    const { client, records } = createClient({ entries: [] });

    await expect(loadPilotEntries(client, context)).resolves.toEqual([]);
    expect(records.map(({ table }) => table)).toEqual(["entradas"]);
  });

  it("preserves trailing decimal scale and maximum-size decimal text from the persisted projections", async () => {
    const persisted = entryFixture({
      id: "entry-maximum",
      valor: "99999999.9999",
      resultados: [{
        id: "result-maximum",
        regra_id: "rule-maximum",
        valor: "99999999.99990",
        factor: "0.800000",
        memoria: { factor: 0.8, ruleVersion: 2 },
      }],
    });
    const { client } = createClient({ entries: [persisted] });

    const [entry] = await loadPilotEntries(client, context);

    expect(entry?.inputValue).toBe("99999999.9999");
    expect(entry?.results[0]?.resultValue).toBe("99999999.99990");
    expect(entry?.results[0]?.factor).toBe("0.800000");
  });

  it("fails the read when entries or scoped audit events fail", async () => {
    const entryFailure = new Error("entries unavailable");
    const failedEntries = createClient({ entryError: entryFailure });
    await expect(loadPilotEntries(failedEntries.client, context)).rejects.toBe(entryFailure);

    const auditFailure = new Error("audit unavailable");
    const failedAudit = createClient({ entries: [entryFixture()], eventError: auditFailure });
    await expect(loadPilotEntries(failedAudit.client, context)).rejects.toBe(auditFailure);
  });

  it("paginates entry and audit reads and keeps each id batch at or below one hundred", async () => {
    const entries = Array.from({ length: 101 }, (_, index) => entryFixture({
      id: `entry-${String(index).padStart(3, "0")}`,
      operation_id: `operation-${index}`,
    }));
    const events = entries.map((entry, index) => auditFixture({
      id: `audit-${index}`,
      recurso_id: entry.id,
      ocorrido_em: `2026-09-${String(1 + (index % 28)).padStart(2, "0")}T00:00:00.000Z`,
    }));
    const { client, records } = createClient({ entries, events });

    const result = await loadPilotEntries(client, context);

    const entryQueries = records.filter(({ table }) => table === "entradas");
    const auditQueries = records.filter(({ table }) => table === "eventos_auditoria");
    expect(result).toHaveLength(101);
    expect(entryQueries.map(({ ranges }) => ranges)).toEqual([[[0, 99]], [[100, 199]]]);
    expect(auditQueries.map(({ included, ranges }) => [included[0]?.[1].length, ranges])).toEqual([
      [100, [[0, 99]]],
      [100, [[100, 199]]],
      [1, [[0, 99]]],
    ]);
    expect(auditQueries.every(({ included }) => included[0]?.[1].length <= 100)).toBe(true);
  });

  it("paginates more than one hundred events for the same visible entry", async () => {
    const events = Array.from({ length: 101 }, (_, index) => auditFixture({
      id: `audit-${String(index).padStart(3, "0")}`,
      ocorrido_em: `2026-09-20T15:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));
    const { client, records } = createClient({ entries: [entryFixture()], events });

    const [entry] = await loadPilotEntries(client, context);

    expect(entry?.auditEvents).toHaveLength(101);
    expect(records.filter(({ table }) => table === "eventos_auditoria").map(({ ranges }) => ranges)).toEqual([
      [[0, 99]],
      [[100, 199]],
    ]);
  });

  it("sorts by submission time descending, puts missing times last, and breaks ties by id", async () => {
    const entries = [
      entryFixture({ id: "entry-b", operation_id: "op-b" }),
      entryFixture({ id: "entry-a", operation_id: "op-a" }),
      entryFixture({ id: "entry-none", operation_id: "op-none" }),
      entryFixture({ id: "entry-newer", operation_id: "op-newer" }),
    ];
    const events = [
      auditFixture({ id: "audit-b", recurso_id: "entry-b", ocorrido_em: "2026-09-20T15:00:00.000Z" }),
      auditFixture({ id: "audit-a", recurso_id: "entry-a", ocorrido_em: "2026-09-20T15:00:00.000Z" }),
      auditFixture({ id: "audit-newer", recurso_id: "entry-newer", ocorrido_em: "2026-09-21T15:00:00.000Z" }),
    ];
    const { client } = createClient({ entries, events });

    const result = await loadPilotEntries(client, context);

    expect(result.map(({ id }) => id)).toEqual(["entry-newer", "entry-a", "entry-b", "entry-none"]);
  });

  it.each([
    ["state", entryFixture({ estado: "unknown" })],
    ["revision", entryFixture({ revisao: 0 })],
    ["decimal", entryFixture({ valor: Number.NaN })],
    ["result memory", entryFixture({ resultados: [resultFixture("result-invalid", "1.2")] })],
  ])("rejects an invalid persisted %s value", async (_field, entry) => {
    const invalid = entry.resultados?.[0];
    if (invalid && _field === "result memory") invalid.memoria = { factor: 0.8, ruleVersion: 0 };
    const { client } = createClient({ entries: [entry] });

    await expect(loadPilotEntries(client, context)).rejects.toThrow();
  });

  it.each([
    ["entry value", entryFixture({ valor: 10.12 })],
    ["result value", entryFixture({
      resultados: [{ ...resultFixture("numeric-result", "8.00000"), valor: 8 }],
    })],
    ["rule factor", entryFixture({
      resultados: [{ ...resultFixture("numeric-factor", "8.00000"), factor: 0.8 }],
    })],
  ])("rejects a numeric JSON %s rather than coercing it to text", async (_field, entry) => {
    const { client } = createClient({ entries: [entry] });

    await expect(loadPilotEntries(client, context)).rejects.toThrow(/invalid (entry value|result value|rule factor)/i);
  });
});
