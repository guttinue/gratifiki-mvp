import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../app/App";
import type { PilotContext } from "../../lib/types";

const authMocks = vi.hoisted(() => ({
  getAuthClient: vi.fn(),
  getPilotContext: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../auth/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/auth")>();
  return { ...actual, ...authMocks };
});

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
  valor: number;
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

function makeQuery(rows: DemoRow[]) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    then: <TResult1 = { data: DemoRow[]; error: null }, TResult2 = never>(
      onfulfilled?: ((value: { data: DemoRow[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve({ data: rows, error: null }).then(onfulfilled, onrejected),
  };

  return builder;
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
      valor: Number(args.p_valor_texto),
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
            factor: 0.8,
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
    from: vi.fn(() => makeQuery(rows)),
    rpc,
  };

  return { client: client as unknown as SupabaseClient, rpc, rows };
}

describe("SR1 entry form in the authenticated application", () => {
  beforeEach(() => {
    window.localStorage.clear();
    const { client } = createClient();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("restores the local session and shows the synthetic entry form for area técnica", async () => {
    render(<App />);

    expect(await screen.findByRole("heading", { level: 1, name: "Entrada do indicador" })).toBeTruthy();
    expect(screen.getByLabelText("Valor para o indicador")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Contexto sintético autorizado" })).toBeTruthy();
    expect(screen.getByText("DEMO-2026-09")).toBeTruthy();
    expect(screen.getByText("DEMO-01")).toBeTruthy();
  });

  it("renders the persisted result and memory returned by the server", async () => {
    const { client } = createClient();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(technicalContext);
    render(<App />);

    fireEvent.change(await screen.findByLabelText("Valor para o indicador"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));

    expect(await screen.findByRole("status").then((node) => node.textContent)).toContain(
      "Resultado sintético persistido: 8",
    );
    const persistedMemory = await screen.findByRole("article", {
      name: /entrada de 10.*resultado persistido de 8/i,
    });
    expect(within(persistedMemory).getByText("Escopo")).toBeTruthy();
    expect(within(persistedMemory).getByText("DEMO-ESCOPO-01")).toBeTruthy();
  });

  it("does not render the submission form for CAM", async () => {
    const camContext = { ...technicalContext, papel: "cam" as const };
    const { client } = createClient();
    authMocks.getAuthClient.mockReturnValue(client);
    authMocks.getPilotContext.mockResolvedValue(camContext);
    render(<App />);

    expect(await screen.findByText(/perfil CAM.*não envia/i)).toBeTruthy();
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
    fireEvent.change(await screen.findByLabelText("Valor para o indicador"), {
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

    fireEvent.change(await screen.findByLabelText("Valor para o indicador"), {
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

    await screen.findByRole("heading", { level: 1, name: "Entrada do indicador" });
    expect((await screen.findByRole("alert")).textContent).toMatch(/estado pendente.*não pôde ser lido/i);
    expect((screen.getByLabelText("Valor para o indicador") as HTMLInputElement).disabled).toBe(true);
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

    fireEvent.change(await screen.findByLabelText("Valor para o indicador"), {
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

    const valueInput = await screen.findByLabelText("Valor para o indicador");
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
