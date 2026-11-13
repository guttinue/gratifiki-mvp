import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { bootstrapAcademicDemo } from "./academicDemo";
import type { Role } from "../../src/features/pilot/types";
import { academicId, academicIndicator, academicScopes, academicV3Months, demoIndicators, demoRuleSet } from './academicFixtures';
const roles: Role[] = ["area_tecnica", "revisor_tecnico", "cam", "gestor_unidade", "gestor_distrital", "administrador", "lideranca"];
const credentials = Object.fromEntries(roles.map(role => [role, { email: `${role}@academic.invalid`, password: "synthetic-test-only" }])) as Record<Role, { email: string; password: string }>;
describe("academic bootstrap safety", () => {
  it.each(["https://example.supabase.co", "http://127.0.0.1.evil.invalid", "http://user:pass@127.0.0.1:54321"])("refuses non-loopback or credential URLs before network calls", async url => {
    await expect(bootstrapAcademicDemo(createClient(url, "not-a-secret"), credentials)).rejects.toThrow(/loopback/i);
  });
  it("refuses non-synthetic identities before provisioning", async () => {
    await expect(bootstrapAcademicDemo(createClient("http://127.0.0.1:54321", "not-a-secret"), { ...credentials, cam: { email: "real@example.com", password: "password" } })).rejects.toThrow(/synthetic/i);
  });
  it("refuses duplicate identities before provisioning", async () => {
    await expect(bootstrapAcademicDemo(createClient("http://127.0.0.1:54321", "not-a-secret"), { ...credentials, cam: credentials.area_tecnica })).rejects.toThrow(/distinct/i);
  });
  // The HTTP boundary is the slow external dependency. Keep the real SDK and
  // bootstrap; emulate only Auth/REST persistence, conflict policy and the
  // BEFORE INSERT closed-cycle guard, which runs before ON CONFLICT resolution.
  // Commands are emulated only as far as the bootstrap observes them: each one
  // bumps the position version (as the server does) and closing/publishing
  // writes the closure rows. Every RPC is recorded with its signed-in actor.
  function fakeBackend() {
    const users: {id:string;email:string}[]=[];
    const tables=new Map<string,Record<string,unknown>[]>([['conjuntos_regra',[{id:demoRuleSet.id,codigo:'DEMO',versao:1}]]]);
    const rpcs: {name:string;actor:string;args:Record<string,unknown>}[]=[];
    const inserts: {table:string;rows:Record<string,unknown>[]}[]=[];
    const requests: string[]=[];
    let sequence=0;
    function rpc(name:string,args:Record<string,unknown>) {
      const rows=(table:string)=>{ if(!tables.has(table)) tables.set(table,[]); return tables.get(table)!; };
      if('p_position_id' in args) {
        const position=rows('posicoes_esperadas').find(p=>p.id===args.p_position_id)!;
        if(position.lock_version!==args.p_expected_version) return {error:{code:'40001',message:'version_conflict'}};
        position.lock_version=Number(position.lock_version)+1;
        if(name==='save_position_draft' && !rows('entradas').some(e=>e.posicao_id===position.id)) rows('entradas').push({id:`entry-${++sequence}`,posicao_id:position.id});
        return {version:position.lock_version};
      }
      const competence=rows('competencias').find(c=>c.id===(args.p_contexto as {competenciaId:string}).competenciaId)!;
      const closure=()=>rows('fechamentos').find(f=>f.competencia_id===competence.id);
      if(name==='get_cycle_checklist') return {version:competence.lock_version??1,snapshotId:closure()?.id??null};
      if(name==='transition_cycle') {
        competence.estado=args.p_action==='consolidate'?'em_consolidacao':'fechada';
        competence.lock_version=Number(competence.lock_version??1)+1;
        if(args.p_action==='close') rows('fechamentos').push({id:`closure-${++sequence}`,competencia_id:competence.id});
        return {status:competence.estado};
      }
      if(name==='publish_cycle_demo') { rows('publicacoes').push({id:`publication-${++sequence}`,fechamento_id:args.p_snapshot_id}); return {status:'publicada_demo'}; }
      return {error:{code:'42501',message:'access_denied'}};
    }
    const client=createClient('http://127.0.0.1:54321','synthetic-admin-key',{auth:{persistSession:false,autoRefreshToken:false,storageKey:'academic-bootstrap-test'},global:{fetch:async(input,init)=>{
      const url=new URL(String(input));
      requests.push(`${init?.method??'GET'} ${url.pathname}${decodeURIComponent(url.search)}`);
      const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
      if(url.pathname==='/auth/v1/token') {
        const body=JSON.parse(String(init?.body)) as {email:string};
        const user=users.find(u=>u.email===body.email);
        if(!user) return json({error:'invalid_grant'},400);
        return json({access_token:`token:${user.id}`,token_type:'bearer',expires_in:3600,refresh_token:'refresh',user:{...user,aud:'authenticated'}});
      }
      if(url.pathname.startsWith('/auth/v1/') && url.pathname!=='/auth/v1/admin/users') return new Response(null,{status:204});
      if(url.pathname.startsWith('/rest/v1/rpc/')) {
        const name=url.pathname.split('/').at(-1)!;
        const args=JSON.parse(String(init?.body)) as Record<string,unknown>;
        rpcs.push({name,actor:new Headers(init?.headers).get('authorization')!.replace('Bearer token:',''),args});
        const result=rpc(name,args) as {error?:unknown};
        return result.error?json(result.error,400):json(result);
      }
      if(url.pathname==='/auth/v1/admin/users') {
        if(init?.method==='POST') {
          const body=JSON.parse(String(init.body)) as {email:string};
          const user={id:`actor-${users.length+1}`,email:body.email}; users.push(user); return json(user);
        }
        return json({users,aud:'authenticated'});
      }
      const table=url.pathname.split('/').at(-1)!;
      if(table==='regras') return json({id:'c0de0000-0000-4000-8000-000000000004',indicador_id:'c0de0000-0000-4000-8000-000000000002',versao:1,fator:0.8});
      const rows=tables.get(table)??[]; tables.set(table,rows);
      if(!init?.method || init.method==='GET') {
        const filters=[...url.searchParams].filter(([key])=>key!=='select').map(([key,value])=>{
          const values=value.replace(/^in\.\(|\)$/g,'').split(',').map(v=>v.replace(/^"|"$/g,''));
          return (row:Record<string,unknown>)=>values.includes(String(row[key]));
        });
        return json(rows.filter(row=>filters.every(match=>match(row))));
      }
      const keys=(url.searchParams.get('on_conflict')??'id').split(',');
      const incoming=JSON.parse(String(init?.body)) as Record<string,unknown>[];
      const closed=new Set((tables.get('fechamentos')??[]).map(row=>row.competencia_id));
      if(['posicoes_esperadas','entradas'].includes(table) && incoming.some(row=>closed.has(row.competencia_id)))
        return json({code:'55000',message:'closed_cycle_is_immutable'},400);
      inserts.push({table,rows:incoming});
      for(const row of incoming) {
        const previous=rows.find(saved=>keys.every(key=>saved[key]===row[key]));
        if(previous) {
          if(!new Headers(init?.headers).get('prefer')?.includes('resolution=ignore-duplicates')) Object.assign(previous,row);
        } else rows.push({...(table==='vinculos'?{id:`link-${++sequence}`}:{}),...(table==='posicoes_esperadas'?{lock_version:1}:{}),...row});
      }
      return new Response(null,{status:201});
    }}});
    return { client, users, tables, rpcs, inserts, requests };
  }
  // I-4: the upgrade/restore check bootstraps the schema before 20261102100000,
  // where the DEMO-v1 tables and the 4-column link key do not exist yet.
  it('legacyOnly writes only what the pre-V3 schema has: model-2 rows, the 3-column link key, no DEMO-v1 read or command', async () => {
    const { client, tables, rpcs, requests } = fakeBackend();
    tables.delete('conjuntos_regra');
    await bootstrapAcademicDemo(client,credentials,{legacyOnly:true});
    expect(requests.filter(r=>r.includes('conjuntos_regra'))).toEqual([]);
    const linkWrites=requests.filter(r=>r.startsWith('POST /rest/v1/vinculos'));
    expect(linkWrites.length).toBeGreaterThan(0);
    expect(new Set(linkWrites.map(r=>/[?&]on_conflict=([^&]*)/.exec(r)?.[1]))).toEqual(new Set(['actor_id,papel,escopo_id']));
    expect(tables.get('competencias')!.map(c=>c.modelo)).toEqual([2,2]);
    expect(tables.get('vinculos')!.every(l=>l.indicador_id===academicIndicator)).toBe(true);
    expect(tables.get('posicoes_esperadas')!.every(p=>p.indicador_id===academicIndicator)).toBe(true);
    expect(rpcs).toEqual([]);
  });
  it('resumes bootstrap without replacing Auth IDs, versions, assignments, revoked links or business rows', async () => {
    const { client, users, tables } = fakeBackend();
    const first=await bootstrapAcademicDemo(client,credentials);
    const position=tables.get('posicoes_esperadas')!.find(p=>p.id===academicId(110))!;
    Object.assign(position,{lock_version:9,informante_id:'reassigned-actor',aplicavel:false});
    const link=tables.get('vinculos')![0]; link.ativo=false; link.lock_version=4;
    const competence=tables.get('competencias')![0]; competence.estado='em_consolidacao'; competence.lock_version=3;
    tables.set('entradas',[{id:'existing-business',lock_version:7}]);
    const second=await bootstrapAcademicDemo(client,credentials);
    expect(second).toEqual(first);
    expect(users).toHaveLength(10);
    expect(tables.get('posicoes_esperadas')!.filter(p=>p.indicador_id===academicIndicator)).toHaveLength(12);
    expect(tables.get('vinculos')!.filter(l=>l.indicador_id===academicIndicator)).toHaveLength(24);
    expect(position).toMatchObject({lock_version:9,informante_id:'reassigned-actor',aplicavel:false});
    expect(link).toMatchObject({ativo:false,lock_version:4});
    expect(competence).toMatchObject({estado:'em_consolidacao',lock_version:3});
    expect(tables.get('entradas')).toEqual([{id:'existing-business',lock_version:7}]);
  });
  it('repeats after a competence is closed without touching its immutable positions', async () => {
    const { client, users, tables, rpcs } = fakeBackend();
    const first=await bootstrapAcademicDemo(client,credentials);
    const before=structuredClone(tables.get('posicoes_esperadas'));
    const calls=rpcs.length;
    tables.set('fechamentos',[{id:'closure',competencia_id:academicId(2)}]);
    tables.get('competencias')!.find(c=>c.id===academicId(2))!.estado='fechada';
    await expect(bootstrapAcademicDemo(client,credentials)).resolves.toEqual(first);
    expect(rpcs).toHaveLength(calls);
    expect(users).toHaveLength(10);
    expect(tables.get('posicoes_esperadas')).toEqual(before);
    expect(tables.get('competencias')!.find(c=>c.id===academicId(2))).toMatchObject({estado:'fechada'});
  });
  it('reports a missing position in a closed competence as an explicit inconsistency instead of repairing it', async () => {
    const { client, tables } = fakeBackend();
    await bootstrapAcademicDemo(client,credentials);
    tables.set('fechamentos',[{id:'closure',competencia_id:academicId(2)}]);
    const positions=tables.get('posicoes_esperadas')!;
    positions.splice(positions.findIndex(p=>p.id===academicId(115)),1);
    await expect(bootstrapAcademicDemo(client,credentials)).rejects.toThrow(/closed competence.*inconsistent/i);
    expect(positions.some(p=>p.id===academicId(115))).toBe(false);
  });

  // V3 (model 3) demonstration data: DEMO-v1 links and the V3 states reached
  // through the real commands, never by writing entries directly.
  const scopeCode=(id:unknown)=>academicScopes.find(s=>s.id===id)!.codigo;
  const unit=(code:string)=>academicScopes.find(s=>s.codigo===code)!.id;
  function who(users:{id:string;email:string}[],id:unknown) { return users.find(u=>u.id===id)!.email.replace('@academic.invalid',''); }
  it('emits DEMO-v1 links for every V3 role and scope', async () => {
    const { client, users, tables } = fakeBackend();
    await bootstrapAcademicDemo(client,credentials);
    const links=tables.get('vinculos')!;
    for (const indicator of demoIndicators) {
      expect(links.filter(l=>l.indicador_id===indicator.id).map(l=>`${who(users,l.actor_id)}:${l.papel}:${scopeCode(l.escopo_id)}:${l.vigencia_inicio}`).sort()).toEqual([
        'administrador:administrador:ACADEMIC-NORTE','area_tecnica:area_tecnica:ACADEMIC-NORTE-1','area_tecnica:area_tecnica:ACADEMIC-NORTE-2',
        'cam:cam:ACADEMIC-NORTE-1','cam:cam:ACADEMIC-NORTE-2','cam:cam:ACADEMIC-SUL-1','cam:cam:ACADEMIC-SUL-2',
        'gestor_distrital:gestor_distrital:ACADEMIC-NORTE','gestor_unidade:gestor_unidade:ACADEMIC-NORTE-1',
        'lideranca:lideranca:ACADEMIC-NORTE','lideranca:lideranca:ACADEMIC-SUL',
        'revisor_tecnico:revisor_tecnico:ACADEMIC-NORTE-1','revisor_tecnico:revisor_tecnico:ACADEMIC-NORTE-2',
        'south+area_tecnica:area_tecnica:ACADEMIC-SUL-1','south+area_tecnica:area_tecnica:ACADEMIC-SUL-2',
        'south+revisor_tecnico:revisor_tecnico:ACADEMIC-SUL-1','south+revisor_tecnico:revisor_tecnico:ACADEMIC-SUL-2',
      ].map(link=>`${link}:2026-01-01`));
    }
    expect(links).toHaveLength(24+4*17);
  });
  it('opens the V3 months with 16 positions each, pinned to the DEMO-v1 rules', async () => {
    const { client, users, tables } = fakeBackend();
    await bootstrapAcademicDemo(client,credentials);
    expect(tables.get('competencias')!.filter(c=>c.modelo===3)).toEqual(academicV3Months.map(m=>expect.objectContaining({id:m.id,codigo:m.codigo,conjunto_id:demoRuleSet.id})));
    for (const month of academicV3Months) {
      const positions=tables.get('posicoes_esperadas')!.filter(p=>p.competencia_id===month.id);
      expect(positions).toHaveLength(16);
      expect(new Set(positions.map(p=>`${p.alvo_id}:${p.indicador_id}`)).size).toBe(16);
      expect(positions.every(p=>p.regra_id===demoIndicators.find(i=>i.id===p.indicador_id)!.regraId)).toBe(true);
      expect(positions.filter(p=>scopeCode(p.alvo_id).startsWith('ACADEMIC-SUL')).every(p=>who(users,p.informante_id)==='south+area_tecnica' && who(users,p.revisor_id)==='south+revisor_tecnico')).toBe(true);
      expect(tables.get('territorios_competencia')!.filter(t=>t.competencia_id===month.id)).toHaveLength(4);
    }
  });
  it('closes and publishes September V3 and builds the October V3 state through the real commands', async () => {
    const { client, users, tables, rpcs } = fakeBackend();
    await bootstrapAcademicDemo(client,credentials);
    const [september,october]=academicV3Months;
    const position=(id:unknown)=>tables.get('posicoes_esperadas')!.find(p=>p.id===id)!;
    const trail=(month:string)=>{
      const steps:Record<string,string[]>={};
      for (const call of rpcs.filter(c=>c.name!=='get_cycle_checklist' && (c.args.p_contexto as {competenciaId:string}).competenciaId===month && c.args.p_position_id)) {
        const p=position(call.args.p_position_id);
        const key=`${scopeCode(p.alvo_id)}:${demoIndicators.find(i=>i.id===p.indicador_id)!.codigo}`;
        const input=call.args.p_input as {estadoDado:string;valor:string|null}|undefined;
        const detail=call.name==='save_position_draft'?`(${input!.estadoDado==='valor'?input!.valor:input!.estadoDado})`:call.name==='review_position'?`(${call.args.p_decision})`:call.name==='decide_unavailability'?`(${call.args.p_reference})`:'';
        (steps[key]??=[]).push(`${who(users,call.actor)}:${call.name}${detail}`);
      }
      return steps;
    };
    const accepted=(value:string,tech='area_tecnica',reviewer='revisor_tecnico')=>[`${tech}:save_position_draft(${value})`,`${tech}:submit_position`,`${reviewer}:start_position_review`,`${reviewer}:review_position(accept)`];
    const south=(value:string)=>accepted(value,'south+area_tecnica','south+revisor_tecnico');
    const values={'ACADEMIC-NORTE-1':['88','18','60','11'],'ACADEMIC-NORTE-2':['96','20','40','12'],'ACADEMIC-SUL-1':['90','19','36','12'],'ACADEMIC-SUL-2':['85','17','52','10']};
    expect(trail(september.id)).toEqual(Object.fromEntries(Object.entries(values).flatMap(([code,list])=>list.map((value,i)=>[`${code}:${demoIndicators[i].codigo}`,code.startsWith('ACADEMIC-SUL')?south(value):accepted(value)]))));
    const cycle=rpcs.filter(c=>['transition_cycle','publish_cycle_demo'].includes(c.name)).map(c=>`${who(users,c.actor)}:${c.name}:${c.args.p_action??''}:${c.args.p_reference}`);
    expect(cycle).toEqual(['cam:transition_cycle:consolidate:','cam:transition_cycle:close:DEMO-DECISAO-V3-SET','cam:publish_cycle_demo::DEMO-PUBLICACAO-V3-SET']);
    expect(tables.get('competencias')!.find(c=>c.id===september.id)).toMatchObject({estado:'fechada'});
    expect(tables.get('publicacoes')).toHaveLength(1);
    expect(trail(october.id)).toEqual({
      'ACADEMIC-NORTE-1:DEMO-V1-01':['area_tecnica:save_position_draft(90)'],
      'ACADEMIC-NORTE-1:DEMO-V1-02':['area_tecnica:save_position_draft(16)','area_tecnica:submit_position'],
      'ACADEMIC-NORTE-1:DEMO-V1-03':['area_tecnica:save_position_draft(96)','area_tecnica:submit_position','revisor_tecnico:start_position_review','revisor_tecnico:review_position(return)'],
      'ACADEMIC-NORTE-1:DEMO-V1-04':accepted('12'),
      'ACADEMIC-NORTE-2:DEMO-V1-01':['area_tecnica:save_position_draft(95)','area_tecnica:submit_position','revisor_tecnico:start_position_review'],
      'ACADEMIC-NORTE-2:DEMO-V1-03':accepted('48'),
      'ACADEMIC-NORTE-2:DEMO-V1-04':accepted('10'),
      'ACADEMIC-SUL-1:DEMO-V1-01':south('92'),'ACADEMIC-SUL-1:DEMO-V1-02':south('21'),'ACADEMIC-SUL-1:DEMO-V1-03':south('30'),'ACADEMIC-SUL-1:DEMO-V1-04':south('12'),
      'ACADEMIC-SUL-2:DEMO-V1-01':south('88'),'ACADEMIC-SUL-2:DEMO-V1-02':south('19'),
      'ACADEMIC-SUL-2:DEMO-V1-03':[...south('indisponivel'),'cam:decide_unavailability(DEMO-V3-INDISP)'],
      'ACADEMIC-SUL-2:DEMO-V1-04':south('11'),
    });
    const returned=rpcs.find(c=>c.name==='review_position' && c.args.p_decision==='return')!;
    expect(returned.args.p_reason).toBe('A fonte informada é de setembro. Confirme o tempo de resposta de outubro e reenvie.');
    expect(rpcs.find(c=>c.name==='save_position_draft' && position(c.args.p_position_id).alvo_id===unit('ACADEMIC-SUL-2') && (c.args.p_input as {estadoDado:string}).estadoDado==='indisponivel')!.args.p_input)
      .toMatchObject({valor:null,motivo:'Sistema de origem fictício fora do ar durante o mês; indisponibilidade registrada e aceita.'});
    // Every command carries the explicit link of its own actor, role, scope and indicator.
    for (const call of rpcs.filter(c=>c.args.p_position_id)) {
      const p=position(call.args.p_position_id);
      const link=tables.get('vinculos')!.find(l=>l.id===(call.args.p_contexto as {vinculoId:string}).vinculoId)!;
      expect(link).toMatchObject({actor_id:call.actor,escopo_id:p.alvo_id,indicador_id:p.indicador_id});
    }
  });
  it('is an exact no-op on a second run once September V3 is closed and published (I4)', async () => {
    const { client, users, tables, rpcs, inserts } = fakeBackend();
    const first=await bootstrapAcademicDemo(client,credentials);
    const before=structuredClone({users,tables:[...tables.entries()]});
    const [calls,writes]=[rpcs.length,inserts.length];
    await expect(bootstrapAcademicDemo(client,credentials)).resolves.toEqual(first);
    expect(rpcs).toHaveLength(calls);
    expect(inserts).toHaveLength(writes);
    expect({users,tables:[...tables.entries()]}).toEqual(before);
  });
  it('never inserts positions into a closed September V3, even when one is missing', async () => {
    const { client, tables, rpcs, inserts } = fakeBackend();
    await bootstrapAcademicDemo(client,credentials);
    const positions=tables.get('posicoes_esperadas')!;
    positions.splice(positions.findIndex(p=>p.competencia_id===academicV3Months[0].id),1);
    const [calls,writes]=[rpcs.length,inserts.length];
    await expect(bootstrapAcademicDemo(client,credentials)).rejects.toThrow(/closed competence ACADEMIC-V3-2026-09.*inconsistent/i);
    expect(inserts.slice(writes).filter(i=>i.table==='posicoes_esperadas')).toEqual([]);
    expect(rpcs).toHaveLength(calls);
  });
});
