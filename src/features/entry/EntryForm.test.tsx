import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import type { PilotContext, PilotEntry } from "../../lib/types";
import { pendingEntryStorageKey, savePendingEntry } from "./pendingEntry";

const authMocks = vi.hoisted(() => ({
  getAuthClient: vi.fn(),
  getPilotContext: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const readModelMocks = vi.hoisted(() => ({ loadPilotEntries: vi.fn() }));

vi.mock("../auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/auth")>();
  return { ...actual, ...authMocks };
});
vi.mock("./pilotReadModel", () => readModelMocks);

const technicalContext: PilotContext = {
  actorId: "d3mo0000-0000-4000-8000-000000000001",
  papel: "area_tecnica",
  competenciaId: "c0de0000-0000-4000-8000-000000000001",
  competenciaCodigo: "DEMO-2026-09",
  referencia: "2026-09-15",
  indicadorId: "c0de0000-0000-4000-8000-000000000002",
  indicadorCodigo: "DEMO-01",
  escopoId: "c0de0000-0000-4000-8000-000000000003",
  escopoCodigo: "DEMO-ESCOPO-01",
};

type DemoRow = {
  id: string;
  competencia_id: string;
  indicador_id: string;
  escopo_id: string;
  autor_id: string;
  valor: string;
  estado: string;
  revisao: number;
  operation_id: string;
  resultados: Array<{
    id: string;
    regra_id: string;
    valor: string;
    memoria: Record<string, number | string>;
  }>;
};

const clientRows = new WeakMap<object, DemoRow[]>();

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function projectReadEntries(rows: DemoRow[], context: PilotContext): PilotEntry[] {
  return rows.map((row) => {
    const submittedAt = "2026-09-30T13:45:00.000Z";
    return {
      id: row.id,
      competenciaId: row.competencia_id,
      competenciaCodigo: context.competenciaCodigo,
      indicadorId: row.indicador_id,
      indicadorCodigo: context.indicadorCodigo,
      escopoId: row.escopo_id,
      escopoCodigo: context.escopoCodigo,
      inputValue: row.valor,
      state: row.estado as PilotEntry["state"],
      revision: row.revisao,
      operationId: row.operation_id,
      results: row.resultados.map((result) => ({
        entryId: row.id,
        resultId: result.id,
        competenciaId: row.competencia_id,
        competenciaCodigo: context.competenciaCodigo,
        indicadorId: row.indicador_id,
        indicadorCodigo: context.indicadorCodigo,
        escopoId: row.escopo_id,
        escopoCodigo: context.escopoCodigo,
        inputValue: row.valor,
        resultValue: result.valor,
        state: row.estado as PilotEntry["state"],
        revision: row.revisao,
        operationId: row.operation_id,
        ruleId: result.regra_id,
        ruleVersion: Number(result.memoria.ruleVersion),
        factor: String(result.memoria.factor),
      })),
      auditEvents: [{
        id: `audit-${row.id}`,
        entryId: row.id,
        action: "demo.entry.submitted",
        occurredAt: submittedAt,
      }],
      submittedAt,
    };
  });
}

function createClient() {
  const rows: DemoRow[] = [];
  const rpc = vi.fn(async (_name: string, args: Record<string, string>) => {
    const entryId = "d3mo0000-0000-4000-8000-000000000010";
    const resultId = "d3mo0000-0000-4000-8000-000000000011";
    rows.push({
      id: entryId,
      competencia_id: technicalContext.competenciaId,
      indicador_id: technicalContext.indicadorId,
      escopo_id: technicalContext.escopoId,
      autor_id: technicalContext.actorId,
      valor: args.p_valor_texto,
      estado: "pendente",
      revisao: 1,
      operation_id: args.p_operation_id,
      resultados: [
        {
          id: resultId,
          regra_id: "c0de0000-0000-4000-8000-000000000004",
          valor: "8",
          memoria: {
            input: 10,
            factor: "0.800000",
            ruleVersion: 1,
            competenceId: technicalContext.competenciaId,
            indicatorId: technicalContext.indicadorId,
          },
        },
      ],
    });

    return {
      data: {
        entryId,
        resultId,
        resultValue: "8",
        ruleVersion: 1,
        operationId: args.p_operation_id,
      },
      error: null,
    };
  });

  const client = {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "synthetic-test-session" } },
        error: null,
      }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
    rpc,
  };

  const typedClient = client as unknown as SupabaseClient;
  clientRows.set(typedClient as object, rows);

  return { client: typedClient, rpc, rows };
}

describe("SR1 entry form in the authenticated application", () => {
  beforeEach(() => {
    window.localStorage.clear();
    readModelMocks.loadPilotEntries.mockImplementation(async (client: SupabaseClient, context: PilotContext) => {
      return projectReadEntries(clientRows.get(client as object) ?? [], context);
    });
    const { client } = createClient();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  async function openEntriesForm() {
    await screen.findByRole("heading", { level: 1, name: "Visão geral" });
    fireEvent.click(screen.getByRole("link", { name: "Entradas" }));
    await screen.findByRole("heading", { level: 1, name: "Entradas" });
    return screen.findByLabelText("Valor para o indicador");
  }

  it("restores the local session and shows the synthetic entry form for area técnica", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Visão geral" })).toBeTruthy();
    expect(await openEntriesForm()).toBeTruthy();
    const contextSummary = screen.getByRole("group", { name: "Contexto sintético autorizado" });
    expect(within(contextSummary).getByText("DEMO-2026-09")).toBeTruthy();
    expect(within(contextSummary).getByText("DEMO-01")).toBeTruthy();
  });

  it("renders the persisted result and memory returned by the server", async () => {
    const { client } = createClient();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    render(<App />);

    fireEvent.change(await openEntriesForm(), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));

    expect(await screen.findByRole("status").then((node) => node.textContent)).toContain(
      "Resultado sintético persistido: 8",
    );
    const submittedRow = await screen.findByRole("row", { name: /d3mo0000/ });
    expect(within(submittedRow).getByText("8")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /ver detalhe da entrada d3mo0000/i }));
    const persistedMemory = await screen.findByRole("region", { name: /detalhe da entrada d3mo0000/i });
    expect(within(persistedMemory).getByText("Escopo autorizado")).toBeTruthy();
    expect(within(persistedMemory).getByText("DEMO-ESCOPO-01")).toBeTruthy();
    expect(within(persistedMemory).getByText("0.800000")).toBeTruthy();
  });

  it("keeps an in-flight submit mounted through navigation and applies its persisted result", async () => {
    const { client, rpc } = createClient();
    const responseGate = deferred<void>();
    const originalRpc = rpc.getMockImplementation();
    rpc.mockImplementationOnce(async (name, args) => {
      await responseGate.promise;
      return originalRpc!(name, args);
    });
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    render(<App />);

    const input = await openEntriesForm();
    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByRole("button", { name: "Enviando…" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Histórico e auditoria" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Histórico e auditoria" })).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Entradas" }));
    expect(await screen.findByRole("button", { name: "Enviando…" })).toBeTruthy();

    await act(async () => responseGate.resolve(undefined));
    expect((await screen.findByRole("status")).textContent).toContain("Resultado sintético persistido: 8");
    expect(await screen.findByRole("row", { name: /d3mo0000/ })).toBeTruthy();
  });

  it.each([
    "",
    "   ",
    "-1",
    "-0",
    "abc",
    "NaN",
    "Infinity",
    "+1",
    ".5",
    "1.",
    "1e2",
    "1,5",
    "0.00001",
    "100000000",
    "\t10",
  ])("marks invalid fresh value %j and blocks persistence and RPC", async (value) => {
    const { client, rpc } = createClient();
    const pendingWrite = vi.spyOn(Storage.prototype, "setItem");
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    render(<App />);

    const input = await openEntriesForm();
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect((input as HTMLInputElement).getAttribute("aria-invalid")).toBe("true");
    const describedBy = (input as HTMLInputElement).getAttribute("aria-describedby");
    expect(describedBy).toBe("demo-value-error");
    expect(document.getElementById(describedBy!)).toBeTruthy();
    expect(window.localStorage.length).toBe(0);
    expect(pendingWrite).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends an invalid payload recovered from storage unchanged so the server can reject it", async () => {
    const operationId = "11111111-1111-4111-8111-111111111111";
    savePendingEntry(technicalContext, { operationId, valueText: "1e2" });
    const { client, rpc } = createClient();
    rpc.mockRejectedValueOnce(Object.assign(new Error("invalid_demo_value"), {
      code: "22023",
      status: 400,
    }));
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    render(<App />);

    const input = await openEntriesForm();
    expect((input as HTMLInputElement).value).toBe("1e2");
    fireEvent.click(await screen.findByRole("button", { name: "Repetir mesma operação" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("submit_demo_entry", expect.objectContaining({
      p_valor_texto: "1e2",
      p_operation_id: operationId,
    }));
    expect((input as HTMLInputElement).value).toBe("1e2");
  });

  it("preserves accepted outer spaces in the pending payload and RPC request", async () => {
    const { client, rpc } = createClient();
    rpc.mockRejectedValueOnce(Object.assign(new Error("network unavailable"), { status: 500 }));
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    render(<App />);

    fireEvent.change(await openEntriesForm(), {
      target: { value: " 10 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await screen.findByRole("button", { name: "Repetir mesma operação" });

    const operationId = rpc.mock.calls[0]?.[1]?.p_operation_id;
    expect(rpc.mock.calls[0]?.[1]?.p_valor_texto).toBe(" 10 ");
    const stored = window.localStorage.getItem(pendingEntryStorageKey(technicalContext));
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored!)).toMatchObject({ valueText: " 10 ", operationId });
  });

  it("does not render the submission form for CAM", async () => {
    const camContext = { ...technicalContext, papel: "cam" as const };
    const { client } = createClient();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(camContext);
    render(<App />);

    fireEvent.click(await screen.findByRole("link", { name: "Entradas" }));
    expect(await screen.findByText(/perfil CAM.*somente leitura/i)).toBeTruthy();
    expect(screen.queryByLabelText("Valor para o indicador")).toBeNull();
  });

  it.each([
    ["another actor", { ...technicalContext, actorId: "d3mo0000-0000-4000-8000-000000000002" }],
    ["another pilot context", { ...technicalContext, escopoId: "c0de0000-0000-4000-8000-000000000004", escopoCodigo: "DEMO-ESCOPO-02" }],
  ])("keeps a pending operation isolated from %s", async (_description, nextContext) => {
    const { client, rpc } = createClient();
    rpc.mockRejectedValueOnce(Object.assign(new Error("network unavailable"), { status: 500 }));
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValueOnce(technicalContext).mockResolvedValueOnce(nextContext);

    const firstApp = render(<App />);
    fireEvent.change(await openEntriesForm(), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));

    expect(await screen.findByRole("button", { name: "Repetir mesma operação" })).toBeTruthy();
    expect(window.localStorage.length).toBe(1);
    firstApp.unmount();

    render(<App />);
    const restoredInput = await screen.findByLabelText("Valor para o indicador");
    expect((restoredInput as HTMLInputElement).value).toBe("");
    expect((restoredInput as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole("button", { name: "Registrar entrada" })).toBeTruthy();
    expect(window.localStorage.length).toBe(1);
  });

  it("does not send an entry when the pending operation cannot be stored", async () => {
    const { client, rpc } = createClient();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    render(<App />);

    fireEvent.change(await openEntriesForm(), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/a entrada não foi enviada/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks submission when it cannot read pending operation state", async () => {
    const { client, rpc } = createClient();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    render(<App />);

    const input = await openEntriesForm();
    expect((await screen.findByRole("alert")).textContent).toMatch(/estado pendente.*não pôde ser lido/i);
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Registrar entrada" }) as HTMLButtonElement).disabled).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps an operation locked when the server reports a payload mismatch", async () => {
    const { client, rpc } = createClient();
    rpc.mockRejectedValueOnce({
      code: "22023",
      message: "operation_id_payload_mismatch",
      status: 400,
    });
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    render(<App />);

    fireEvent.change(await openEntriesForm(), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/operação anterior com outro valor/i);
    expect((screen.getByLabelText("Valor para o indicador") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Repetir mesma operação" })).toBeTruthy();
  });

  it("does not discard an unresolved operation when a later retry has an expired session", async () => {
    const { client, rpc } = createClient();
    rpc
      .mockRejectedValueOnce(Object.assign(new Error("network unavailable"), { status: 500 }))
      .mockRejectedValueOnce({ code: "PGRST301", message: "JWT expired", status: 401 });
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    render(<App />);

    const valueInput = await openEntriesForm();
    fireEvent.change(valueInput, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    fireEvent.click(await screen.findByRole("button", { name: "Repetir mesma operação" }));

    expect((await screen.findByRole("alert")).textContent).toMatch(/sessão.*expir/i);
    expect((valueInput as HTMLInputElement).value).toBe("10");
    expect((valueInput as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Repetir mesma operação" })).toBeTruthy();
    expect(rpc.mock.calls[1]?.[1]?.p_operation_id).toBe(rpc.mock.calls[0]?.[1]?.p_operation_id);
    expect(window.localStorage.length).toBe(1);
  });
});
