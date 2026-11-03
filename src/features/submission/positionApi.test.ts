import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { listPositions, loadPositionDetail, saveDraft } from "./positionApi";

const context = { vinculoId: "link", competenciaId: "month", indicadorId: "indicator" };
const position = { id: "position", escopoId: "scope", escopoCodigo: "NORTE-1", escopoTipo: "unidade", aplicavel: true,
  status: "ausente", estadoDado: null, version: 1, revisionId: null, inputValue: null, resultValue: null };
function transport(value: unknown) {
  return createClient("http://127.0.0.1:54321", "public-test-key", { auth: { persistSession: false,storageKey:crypto.randomUUID() },
    global: { fetch: async (_url, init) => {
      const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(payload.p_contexto).toEqual(context);
      return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
    } } });
}
describe("operational position boundary", () => {
  it.each([{resourceId:'other',version:2,revisionId:'rev',status:'rascunho',resultValue:null},{resourceId:'position',version:2,revisionId:null,status:'rascunho',resultValue:null},{resourceId:'position',version:2,revisionId:'rev',status:'rascunho',resultValue:'8'}])('rejects incompatible save receipt',async(receipt)=>{
    await expect(saveDraft(transport(receipt),context,'position',1,{estadoDado:'valor',valor:'10',fonte:'',periodoFonte:'',motivo:''},'op')).rejects.toThrow();
  });
  it('sends canonical decimal and only command context fields; decodes exact receipt',async()=>{
    const client=createClient('http://localhost:54321','public-key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch:async(_url,init)=>{
      expect(JSON.parse(String(init?.body))).toEqual({p_contexto:context,p_position_id:'position',p_expected_version:7,p_input:{estadoDado:'valor',valor:'0.0001',fonte:'source',periodoFonte:'2026-10-01',motivo:''},p_operation_id:'operation'});
      return new Response(JSON.stringify({resourceId:'position',version:8,revisionId:'revision',status:'rascunho',resultValue:null}),{headers:{'content-type':'application/json'}});
    }}});
    expect(await saveDraft(client,{...context,actorId:'untrusted'} as typeof context,'position',7,{estadoDado:'valor',valor:'0,0001',fonte:' source ',periodoFonte:'2026-10-01',motivo:''},'operation')).toEqual({resourceId:'position',version:8,revisionId:'revision',status:'rascunho',resultValue:null});
  });
  it("counts_expected_even_without_entry", async () => {
    const page = await listPositions(transport({ items: Array.from({ length: 6 }, (_, i) => ({ ...position, id: `position-${i}` })), total: 6, page: 1, pageSize: 25 }), context, { page: 1, pageSize: 25 });
    expect(page.total).toBe(6);
    expect(page.items.filter(p => p.status === "ausente")).toHaveLength(6);
  });
  it("preserves precise decimal text and typed detail history", async () => {
    const detail = await loadPositionDetail(transport({ position: { ...position, status: "enviada", estadoDado: "valor", revisionId: "revision", inputValue: "0.0001", resultValue: "0.00008" },
      revisions: [{ id: "revision", number: 1, authorId: "actor", estadoDado: "valor", value: "0.0001", source: "synthetic", sourcePeriod: "2026-10", reason: "", submittedAt: "2026-10-01T00:00:00Z" }], decisions: [],
      memories: [{ revisionId: "revision", ruleVersion: 1, factor: "0.8", inputValue: "0.0001", resultValue: "0.00008" }] }), context, "position");
    expect(detail.position.resultValue).toBe("0.00008");
    expect(detail.revisions[0].value).toBe("0.0001");
    expect(detail.memories[0].factor).toBe("0.8");
  });
  it.each([{ ...position, resultValue: 0.00008 }, { ...position, status: "pendente" }, { ...position, version: 0 }, { ...position, estadoDado: undefined }])("rejects malformed position DTO", async (item) => {
    await expect(listPositions(transport({ items: [item], total: 1, page: 1, pageSize: 25 }), context, { page: 1, pageSize: 25 })).rejects.toThrow();
  });
  it("decodes a meta/weight memory without a factor and keeps factor memories strict", async () => {
    const sent = { ...position, status: "enviada", estadoDado: "valor", revisionId: "revision", inputValue: "90", resultValue: "28.42" };
    const metaPeso = { revisionId: "revision", ruleVersion: 1, method: "meta_peso", factor: null, inputValue: "90", resultValue: "28.42" };
    const detail = await loadPositionDetail(transport({ position: sent, revisions: [], decisions: [], memories: [metaPeso] }), context, "position");
    expect(detail.memories).toEqual([metaPeso]);
    const factor = { revisionId: "revision", ruleVersion: 1, factor: "0.8", inputValue: "10", resultValue: "8" };
    await expect(loadPositionDetail(transport({ position: sent, revisions: [], decisions: [], memories: [{ ...factor, method: "fator" }] }), context, "position")).resolves.toBeTruthy();
    for (const memory of [{ ...factor, factor: null }, { ...factor, factor: undefined }, { ...factor, method: "fator", factor: null },
      { ...metaPeso, factor: "0.8" }, { ...metaPeso, method: "invented" }]) {
      await expect(loadPositionDetail(transport({ position: sent, revisions: [], decisions: [], memories: [memory] }), context, "position")).rejects.toThrow();
    }
  });
  it("rejects malformed typed histories", async () => {
    await expect(loadPositionDetail(transport({ position, revisions: [], decisions: [{ type: "invented" }], memories: [] }), context, "position")).rejects.toThrow();
  });
});
