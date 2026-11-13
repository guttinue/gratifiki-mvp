import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Role } from "../../src/features/pilot/types.ts";
import { academicId, academicIndicator, academicMonths, academicRoles, academicRule, academicScopes, academicV3Months, demoIndicators, demoRuleSet, secondaryCredentials, type AcademicCredentials } from './academicFixtures.ts';

function assertLoopback(client: SupabaseClient) {
  const raw: unknown = Reflect.get(client,'supabaseUrl');
  let url: URL;
  try { url = new URL(String(raw)); } catch { throw new Error('Academic bootstrap requires local loopback'); }
  if (url.protocol!=='http:' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('Academic bootstrap requires local loopback');
}
// Credentials create missing synthetic users only. Re-running does not rotate
// existing credentials or overwrite mutable business/catalog state.
// legacyOnly is for the upgrade/restore check on the schema before
// 20261102100000: model-2 rows only, that schema's 3-column link key, no
// DEMO-v1 set, months, links or V3 states (seeded after the last migration).
export async function bootstrapAcademicDemo(client: SupabaseClient, credentials: AcademicCredentials, { legacyOnly = false }: { legacyOnly?: boolean } = {}): Promise<{ actors: Record<Role, string> }> {
  assertLoopback(client);
  const secondary = secondaryCredentials(credentials);
  const allCredentials = [...academicRoles.map(role => credentials[role]),...Object.values(secondary)];
  if (allCredentials.some(c => !c || !/^[^\s@]+@[^\s@]+\.invalid$/i.test(c.email) || c.password.length<8)) throw new Error('Only synthetic .invalid identities with supplied passwords are allowed');
  if (new Set(allCredentials.map(c=>c.email.toLowerCase())).size!==allCredentials.length) throw new Error('Academic identities must be distinct');
  // Refuse incompatible roots; never rewrite a rule/version already in use.
  const { data: rule, error: rootError } = await client.from('regras').select('id,indicador_id,versao,fator').eq('id',academicRule).single();
  if (rootError || !rule || rule.indicador_id!==academicIndicator || rule.versao!==1 || String(rule.fator)!=='0.8') throw new Error('Academic synthetic rule roots missing or incompatible');
  // The DEMO-v1 catalogue comes only from its migration; the bootstrap never writes rules.
  if (!legacyOnly) {
    const { data: ruleSets, error: setError } = await client.from('conjuntos_regra').select('id,codigo,versao').in('id',[demoRuleSet.id]);
    if (setError || ruleSets?.length!==1 || ruleSets[0].codigo!==demoRuleSet.codigo || ruleSets[0].versao!==demoRuleSet.versao) throw new Error('Academic DEMO-v1 rule set missing or incompatible');
  }
  // Only rows that are really absent are sent. Closed-cycle guards run BEFORE
  // INSERT, ahead of ON CONFLICT, so resending existing rows would fail; the
  // conflict policy stays only to absorb a concurrent bootstrap.
  async function missingRows<T extends Record<string, unknown>>(table: string, rows: T[], conflict: string): Promise<T[]> {
    const keys = conflict.split(',');
    const { data, error } = await client.from(table).select(conflict).in(keys[0], [...new Set(rows.map(row => String(row[keys[0]])))]);
    if (error || !data) throw new Error(`Academic bootstrap could not inspect ${table}; existing state was not reset`);
    const saved = data as unknown as Record<string, unknown>[];
    return rows.filter(row => !saved.some(existing => keys.every(key => String(existing[key]) === String(row[key]))));
  }
  async function insertOnly<T extends Record<string, unknown>>(table: string, rows: T[], conflict = 'id') {
    const missing = await missingRows(table, rows, conflict);
    if (!missing.length) return;
    const { error } = await client.from(table).upsert(missing as object[],{ onConflict: conflict, ignoreDuplicates: true });
    if (error) throw new Error(`Academic bootstrap could not initialize ${table}; existing state was not reset`);
  }
  const actors = {} as Record<Role,string>;
  async function ensureIdentity(c: { email: string; password: string }, label: string) {
    let existing: { id: string } | undefined;
    for (let page=1; ;page++) {
      const { data, error } = await client.auth.admin.listUsers({page,perPage:1000});
      if (error) throw new Error('Academic identities could not be inspected');
      existing = data.users.find(user=>user.email?.toLowerCase()===c.email.toLowerCase());
      if (existing || data.users.length<1000) break;
    }
    if (!existing) {
      const { data,error }=await client.auth.admin.createUser({email:c.email,password:c.password,email_confirm:true});
      if(error || !data.user) throw new Error('Academic identity could not be provisioned');
      existing=data.user;
    }
    await insertOnly('contas_demo',[{ator_id:existing.id,rotulo:label}],'ator_id');
    return existing.id;
  }
  for (const role of academicRoles) actors[role]=await ensureIdentity(credentials[role],`Conta acadêmica ${role}`);
  const southTechnical = await ensureIdentity(secondary.southTechnical,'Área técnica Sul / duplo vínculo');
  const southReviewer = await ensureIdentity(secondary.southReviewer,'Revisor Sul');
  const partialCam = await ensureIdentity(secondary.partialCam,'CAM com cobertura parcial');
  await insertOnly('escopos',academicScopes.slice(0,2));
  await insertOnly('escopos',academicScopes.slice(2));
  await insertOnly('competencias',legacyOnly?academicMonths:[...academicMonths,...academicV3Months]);
  const north = new Set([academicId(10),academicId(12),academicId(13)]);
  const units = academicScopes.filter(s=>s.tipo==='unidade');
  const informant = (scope:string) => north.has(scope)?actors.area_tecnica:southTechnical;
  const reviewer = (scope:string) => north.has(scope)?actors.revisor_tecnico:southReviewer;
  const months = [
    ...academicMonths.map((month,monthIndex)=>({month,positions:academicScopes.map((scope,index)=>({id:academicId(100+monthIndex*10+index),competencia_id:month.id,indicador_id:academicIndicator,alvo_id:scope.id,regra_id:academicRule,informante_id:informant(scope.id),revisor_id:reviewer(scope.id)}))})),
    // Model 3: 4 units x 4 DEMO-v1 indicators, each pinned to its set item rule.
    ...(legacyOnly?[]:academicV3Months).map((month,monthIndex)=>({month,positions:units.flatMap((scope,unitIndex)=>demoIndicators.map((indicator,index)=>({id:academicId(200+monthIndex*16+unitIndex*4+index),competencia_id:month.id,indicador_id:indicator.id,alvo_id:scope.id,regra_id:indicator.regraId,informante_id:informant(scope.id),revisor_id:reviewer(scope.id)})))})),
  ];
  const { data: closures, error: closureError } = await client.from('fechamentos').select('competencia_id').in('competencia_id',months.map(m=>m.month.id));
  if (closureError || !closures) throw new Error('Academic bootstrap could not inspect closed competences; existing state was not reset');
  const closed = new Set(closures.map(c=>String(c.competencia_id)));
  for (const { month, positions } of months) {
    await insertOnly('territorios_competencia',units.map(s=>({competencia_id:month.id,unidade_id:s.id,distrito_id:s.distrito_id})),'competencia_id,unidade_id');
    // A closed competence is history: a gap there is reported, never repaired.
    if (closed.has(month.id)) {
      if ((await missingRows('posicoes_esperadas',positions,'id')).length) throw new Error(`Academic bootstrap found the closed competence ${month.codigo} inconsistent: expected positions are missing and were not recreated`);
      continue;
    }
    await insertOnly('posicoes_esperadas',positions);
  }
  const links: {actor_id:string;papel:Role;escopo_id:string;indicador_id:string;vigencia_inicio:string}[]=[];
  function link(actor:string,role:Role,scope:string,indicator=academicIndicator) { links.push({actor_id:actor,papel:role,escopo_id:scope,indicador_id:indicator,vigencia_inicio:'2026-01-01'}); }
  for (const scope of academicScopes) {
    link(informant(scope.id),'area_tecnica',scope.id);
    link(reviewer(scope.id),'revisor_tecnico',scope.id);
    link(actors.cam,'cam',scope.id);
  }
  link(actors.gestor_unidade,'gestor_unidade',academicId(12));
  for (const role of ['gestor_distrital','administrador','lideranca'] as const) link(actors[role],role,academicId(10));
  link(partialCam,'cam',academicId(10));
  link(southTechnical,'cam',academicId(14));
  // V3: one link per DEMO-v1 indicator. Leadership sees both districts.
  for (const indicator of legacyOnly?[]:demoIndicators) {
    for (const scope of units) {
      link(informant(scope.id),'area_tecnica',scope.id,indicator.id);
      link(reviewer(scope.id),'revisor_tecnico',scope.id,indicator.id);
      link(actors.cam,'cam',scope.id,indicator.id);
    }
    link(actors.gestor_unidade,'gestor_unidade',academicId(12),indicator.id);
    link(actors.gestor_distrital,'gestor_distrital',academicId(10),indicator.id);
    link(actors.lideranca,'lideranca',academicId(10),indicator.id);
    link(actors.lideranca,'lideranca',academicId(11),indicator.id);
    link(actors.administrador,'administrador',academicId(10),indicator.id);
  }
  await insertOnly('vinculos',links,legacyOnly?'actor_id,papel,escopo_id':'actor_id,papel,escopo_id,indicador_id');
  if (legacyOnly) return { actors };
  await seedV3States(client,{
    technical:{...credentials.area_tecnica,id:actors.area_tecnica},reviewer:{...credentials.revisor_tecnico,id:actors.revisor_tecnico},
    southTechnical:{...secondary.southTechnical,id:southTechnical},southReviewer:{...secondary.southReviewer,id:southReviewer},cam:{...credentials.cam,id:actors.cam},
  },months.filter(m=>m.month.modelo===3),north);
  return { actors };
}

type Identity = { email: string; password: string; id: string };
type Position = { id: string; competencia_id: string; indicador_id: string; alvo_id: string };
type Step = 'draft'|'submit'|'claim'|'review'|'decide';
type Plan = { value: string|null; until: Step; reason?: string; source?: string; period?: string; returnReason?: string };
const steps: Step[] = ['draft','submit','claim','review','decide'];
const accept = (value: string): Plan => ({ value, until: 'review' });
// V3 prototype values, in DEMO-v1 order, by unit (Alfa, Beta, Gama, Delta).
const septemberPlan: Record<string,(Plan|null)[]> = {
  'ACADEMIC-NORTE-1': ['88','18','60','11'].map(accept), 'ACADEMIC-NORTE-2': ['96','20','40','12'].map(accept),
  'ACADEMIC-SUL-1': ['90','19','36','12'].map(accept), 'ACADEMIC-SUL-2': ['85','17','52','10'].map(accept),
};
const octoberPlan: Record<string,(Plan|null)[]> = {
  'ACADEMIC-NORTE-1': [{value:'90',until:'draft'},{value:'16',until:'submit'},
    {value:'96',until:'review',source:'Relatório sintético de setembro',period:'2026-09-01',returnReason:'A fonte informada é de setembro. Confirme o tempo de resposta de outubro e reenvie.'},accept('12')],
  'ACADEMIC-NORTE-2': [{value:'95',until:'claim'},null,accept('48'),accept('10')],
  'ACADEMIC-SUL-1': ['92','21','30','12'].map(accept),
  'ACADEMIC-SUL-2': [accept('88'),accept('19'),{value:null,until:'decide',reason:'Sistema de origem fictício fora do ar durante o mês; indisponibilidade registrada e aceita.'},accept('11')],
};

// The V3 states are reached only through the real commands, as the synthetic
// principals themselves. A position that any command already touched
// (lock_version > 1) and a closed or published month are never driven again,
// so a repeated bootstrap issues no command and no sign-in at all (I4).
async function seedV3States(client: SupabaseClient, who: Record<'technical'|'reviewer'|'southTechnical'|'southReviewer'|'cam',Identity>,
  months: { month: { id: string }; positions: Position[] }[], north: Set<string>) {
  const failed = (what: string) => new Error(`Academic bootstrap could not ${what} for the V3 demonstration; existing state was not reset`);
  const read = async <T,>(query: PromiseLike<{ data: T[]|null; error: unknown }>, what: string) => { const { data, error } = await query; if (error || !data) throw failed(what); return data; };
  const allPositions = months.flatMap(m=>m.positions);
  const versions = new Map((await read(client.from('posicoes_esperadas').select('id,lock_version').in('id',allPositions.map(p=>p.id)),'inspect positions') as {id:string;lock_version:number}[]).map(p=>[p.id,p.lock_version]));
  const competences = new Map((await read(client.from('competencias').select('id,estado').in('id',months.map(m=>m.month.id)),'inspect competences') as {id:string;estado:string}[]).map(c=>[c.id,c.estado]));
  const closures = await read(client.from('fechamentos').select('id,competencia_id').in('competencia_id',months.map(m=>m.month.id)),'inspect closures') as {id:string;competencia_id:string}[];
  const links = await read(client.from('vinculos').select('id,actor_id,papel,escopo_id,indicador_id').in('indicador_id',demoIndicators.map(i=>i.id)),'inspect links') as {id:string;actor_id:string;papel:string;escopo_id:string;indicador_id:string}[];
  const context = (actor: Identity, role: string, position: Position) => {
    const found = links.find(l=>l.actor_id===actor.id && l.papel===role && l.escopo_id===position.alvo_id && l.indicador_id===position.indicador_id);
    if (!found) throw failed('find a DEMO-v1 link');
    return { vinculoId: found.id, competenciaId: position.competencia_id, indicadorId: position.indicador_id };
  };
  const url = String(Reflect.get(client,'supabaseUrl')), key = String(Reflect.get(client,'supabaseKey'));
  const customFetch = (Reflect.get(client,'settings') as { global?: { fetch?: typeof fetch } } | undefined)?.global?.fetch;
  const sessions = new Map<string,SupabaseClient>();
  async function as(identity: Identity) {
    let session = sessions.get(identity.id);
    if (!session) {
      session = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:customFetch}});
      if ((await session.auth.signInWithPassword({email:identity.email,password:identity.password})).error) throw failed('sign in a synthetic principal');
      sessions.set(identity.id,session);
    }
    return session;
  }
  async function call(identity: Identity, name: string, args: Record<string,unknown>, operation = true) {
    const { data, error } = await (await as(identity)).rpc(name,operation?{...args,p_operation_id:crypto.randomUUID()}:args);
    if (error || !data) throw failed(`run ${name} (${error?.code ?? 'no data'})`);
    return data as { version: number; snapshotId: string|null };
  }
  async function drive(position: Position, plan: Plan) {
    const isNorth = north.has(position.alvo_id);
    const technical = isNorth?who.technical:who.southTechnical, reviewer = isNorth?who.reviewer:who.southReviewer;
    const month = position.competencia_id===academicV3Months[0].id?'2026-09-01':'2026-10-01';
    const until = steps.indexOf(plan.until);
    const target = { p_position_id: position.id };
    let version = 1;
    version = (await call(technical,'save_position_draft',{p_contexto:context(technical,'area_tecnica',position),...target,p_expected_version:version,
      p_input:{estadoDado:plan.value===null?'indisponivel':'valor',valor:plan.value,fonte:plan.source??'Painel sintético de acompanhamento',periodoFonte:plan.period??month,motivo:plan.reason??''}})).version;
    if (until<1) return;
    version = (await call(technical,'submit_position',{p_contexto:context(technical,'area_tecnica',position),...target,p_expected_version:version})).version;
    if (until<2) return;
    version = (await call(reviewer,'start_position_review',{p_contexto:context(reviewer,'revisor_tecnico',position),...target,p_expected_version:version})).version;
    if (until<3) return;
    version = (await call(reviewer,'review_position',{p_contexto:context(reviewer,'revisor_tecnico',position),...target,p_expected_version:version,
      p_decision:plan.returnReason?'return':'accept',p_reason:plan.returnReason??''})).version;
    if (until<4) return;
    await call(who.cam,'decide_unavailability',{p_contexto:context(who.cam,'cam',position),...target,p_expected_version:version,
      p_reference:'DEMO-V3-INDISP',p_reason:'Indisponibilidade sintética decidida pela CAM na demonstração V3'});
  }
  try {
    for (const { month, positions } of months) {
      if (closures.some(c=>c.competencia_id===month.id) || competences.get(month.id)!=='aberta') continue;
      const plan = month.id===academicV3Months[0].id?septemberPlan:octoberPlan;
      for (const position of positions) {
        const step = plan[academicScopes.find(s=>s.id===position.alvo_id)!.codigo][demoIndicators.findIndex(i=>i.id===position.indicador_id)];
        if (step && versions.get(position.id)===1) await drive(position,step);
      }
    }
    // September V3 is consolidated, closed and published by the CAM (I4: once).
    // The server requires the DEMO-DECISAO-/DEMO-PUBLICACAO- prefixes.
    const september = months.find(m=>m.month.id===academicV3Months[0].id)!.positions[0];
    const cam = { p_contexto: context(who.cam,'cam',september) };
    const checklist = () => call(who.cam,'get_cycle_checklist',cam,false);
    const state = competences.get(september.competencia_id);
    let closure = closures.find(c=>c.competencia_id===september.competencia_id)?.id;
    if (!closure && state!=='fechada') {
      if (state==='aberta')
        await call(who.cam,'transition_cycle',{...cam,p_expected_version:(await checklist()).version,p_action:'consolidate',p_reason:'',p_reference:''});
      await call(who.cam,'transition_cycle',{...cam,p_expected_version:(await checklist()).version,p_action:'close',p_reason:'Fechamento sintético da demonstração V3',p_reference:'DEMO-DECISAO-V3-SET'});
      closure = (await checklist()).snapshotId ?? undefined;
      if (!closure) throw failed('close September');
    }
    if (closure && !(await read(client.from('publicacoes').select('id').in('fechamento_id',[closure]),'inspect publications')).length)
      await call(who.cam,'publish_cycle_demo',{...cam,p_snapshot_id:closure,p_reference:'DEMO-PUBLICACAO-V3-SET'});
  } finally {
    for (const session of sessions.values()) await session.auth.signOut();
  }
}
