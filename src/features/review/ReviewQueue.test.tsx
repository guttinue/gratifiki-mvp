import { groupContexts } from '../context/contextGroups';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it } from 'vitest';
import { AcademicWorkspace } from '../workspace/AcademicWorkspace';
import { startReview, reviewPosition } from './reviewApi';
import type { AuthorizedContext } from '../pilot/types';
const openAcademicPage=(page:string)=>window.history.replaceState({},'',`/#academico/${page}`);
afterEach(cleanup);
const context:AuthorizedContext={key:'review',actorId:'reviewer',role:'revisor_tecnico',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',escopoId:'scope',escopoCodigo:'NORTE',competenciaCodigo:'2026-10',mode:'academic',modelo:2};
const position={id:'pos',escopoId:'scope',escopoCodigo:'NORTE-1',escopoTipo:'unidade',aplicavel:true,status:'enviada',estadoDado:'valor',version:3,revisionId:'revision',inputValue:'10',resultValue:'8'};
const detail={position,revisions:[{id:'revision',number:1,authorId:'author',estadoDado:'valor',value:'10',source:'Synthetic origin',sourcePeriod:'2026-10-01',reason:'',submittedAt:'2026-10-20T12:00:00Z'}],decisions:[],memories:[{revisionId:'revision',ruleVersion:1,factor:'0.8',inputValue:'10',resultValue:'8'}]};
function response(data:unknown){return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});}
function client(fetch:typeof globalThis.fetch){return createClient('http://localhost:54321','key',{auth:{persistSession:false,storageKey:crypto.randomUUID()},global:{fetch}});}
it('integrates the queue into the authenticated host; requires claim then a motivated return',async()=>{
 const calls:Record<string,unknown>[]=[];
 const api=client(async(url,options)=>{
  if(String(url).includes('get_operational_positions'))return response({items:[position],total:1,page:1,pageSize:25});
  if(String(url).includes('get_position_detail'))return response(detail);
  const args=JSON.parse(String(options?.body));calls.push(args);
  return response({resourceId:'pos',version:calls.length+3,revisionId:'revision',status:calls.length===1?'em_revisao':'devolvida',resultValue:'8'});
 });
 openAcademicPage('conferencia');
 render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1 · enviada/}));
 expect(await screen.findByText('Synthetic origin')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Aceitar evidência'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Iniciar revisão'}));
 const accept=await screen.findByRole('button',{name:'Aceitar evidência'});expect((accept as HTMLButtonElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Devolver com motivo'}));
 expect(await screen.findByRole('alert')).toBeTruthy();expect(calls).toHaveLength(1);
 fireEvent.change(screen.getByLabelText('Motivo da conferência'),{target:{value:'  Corrigir a fonte sintética  '}});
 fireEvent.click(screen.getByRole('button',{name:'Devolver com motivo'}));
 expect(await screen.findByText('Conferência confirmada: devolvida.')).toBeTruthy();
 expect(calls[1]).toMatchObject({p_decision:'return',p_reason:'Corrigir a fonte sintética',p_expected_version:4});
});
it('retains the exact pending review operation after an ambiguous response and retries it',async()=>{
 const bodies:unknown[]=[];let lost=true;
 const api=client(async(url,options)=>{
  if(String(url).includes('get_operational_positions'))return response({items:[position],total:1,page:1,pageSize:25});
  if(String(url).includes('get_position_detail'))return response(detail);
  bodies.push(JSON.parse(String(options?.body)));
  if(lost){lost=false;return response(null);}
  return response({resourceId:'pos',version:4,revisionId:'revision',status:'em_revisao',resultValue:'8'});
 });
 openAcademicPage('conferencia');
 render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));fireEvent.click(await screen.findByRole('button',{name:'Iniciar revisão'}));
 fireEvent.click(await screen.findByRole('button',{name:'Repetir operação pendente'}));
 expect(await screen.findByRole('button',{name:'Aceitar evidência'})).toBeTruthy();expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);
});
it('discards late review completions when another authorized context is selected',async()=>{
 let finish!:(value:Response)=>void;const pending=new Promise<Response>(resolve=>{finish=resolve;});
 const api=client(async url=>String(url).includes('get_operational_positions')?response({items:[position],total:1,page:1,pageSize:25}):String(url).includes('get_position_detail')?response(detail):pending);
 openAcademicPage('conferencia');
 const view=render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1/}));fireEvent.click(await screen.findByRole('button',{name:'Iniciar revisão'}));
 view.rerender(<AcademicWorkspace client={api} group={groupContexts([{...context,key:'other',role:'gestor_unidade',escopoCodigo:'OUTRO'}])[0]} onSignOut={()=>{}} />);
 await act(async()=>{finish(response({resourceId:'pos',version:4,revisionId:'revision',status:'em_revisao',resultValue:'8'}));});
 expect(screen.getByText(/OUTRO/)).toBeTruthy();expect(screen.queryByText(/Conferência confirmada/)).toBeNull();expect(screen.queryByRole('button',{name:'Aceitar evidência'})).toBeNull();
});
it('checks command-specific receipts and does not trust role or actor fields from context',async()=>{
 const bodies:unknown[]=[];
 const api=client(async(_url,options)=>{bodies.push(JSON.parse(String(options?.body)));return response({resourceId:'pos',version:5,revisionId:'revision',status:'validada',resultValue:'8'});});
 const accepted=await reviewPosition(api,context,'pos',4,'accept','  ok  ','op');expect(accepted.status).toBe('validada');
 expect(bodies[0]).toEqual({p_contexto:{vinculoId:'link',competenciaId:'month',indicadorId:'indicator'},p_position_id:'pos',p_expected_version:4,p_decision:'accept',p_reason:'ok',p_operation_id:'op'});
 await expect(startReview(api,context,'pos',3,'start')).rejects.toMatchObject({confirmedRejected:false});
 await expect(reviewPosition(api,context,'other',4,'accept','','wrong')).rejects.toMatchObject({confirmedRejected:false});
});
it('does not describe absent evidence as a pending CAM unavailability decision',async()=>{
 const api=client(async url=>String(url).includes('get_operational_positions')?response({items:[{...position,status:'ausente',estadoDado:null,revisionId:null,inputValue:null,resultValue:null}],total:1,page:1,pageSize:25}):response({position:{...position,status:'ausente',estadoDado:null,revisionId:null,inputValue:null,resultValue:null},revisions:[],decisions:[],memories:[]}));
 openAcademicPage('conferencia');
 render(<AcademicWorkspace client={api} group={groupContexts([context])[0]} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1 · ausente/}));
 await screen.findByRole('heading',{name:'NORTE-1'});
 expect(screen.queryByText(/decisão CAM pendente/)).toBeNull();
 expect(screen.queryByRole('button',{name:'Iniciar revisão'})).toBeNull();
});
const camContext:AuthorizedContext={...context,key:'cam-queue',actorId:'cam',role:'cam'};
function paged(count:number){
 const all=Array.from({length:count},(_,i)=>({...position,id:`pos-${i+1}`,escopoCodigo:`ALVO-${String(i+1).padStart(2,'0')}`,status:'ausente',estadoDado:null,revisionId:null,inputValue:null,resultValue:null}));
 const filters:Record<string,unknown>[]=[];
 const api=client(async(url,options)=>{
  const body=JSON.parse(String(options?.body??'{}'));
  if(String(url).includes('get_operational_positions')){
   const f=body.p_filters as {page:number;pageSize:number;search?:string};filters.push(f);
   const matching=all.filter(p=>!f.search||p.escopoCodigo.includes(f.search));
   return response({items:matching.slice((f.page-1)*f.pageSize,f.page*f.pageSize),total:matching.length,page:f.page,pageSize:f.pageSize});
  }
  if(String(url).includes('get_position_detail')){const p=all.find(row=>row.id===body.p_position_id)!;return response({position:p,revisions:[],decisions:[],memories:[]});}
  if(String(url).includes('get_cycle_checklist'))return response({version:1,state:'aberta',expected:count,received:0,reviewed:0,unavailable:0,decidedUnavailable:0,notApplicable:0,fullCoverage:true,canConsolidate:false,canClose:false,snapshotId:null,publication:'nao_publicada',publicationId:null,blockers:[{positionId:'pos-26',code:'missing_submission',message:'Envio ausente.'}]});
  return response(null);
 });
 return {api,filters};
}
it('pages the CAM queue beyond the first 25 authorized targets and opens the 26th',async()=>{
 const {api,filters}=paged(26);
 openAcademicPage('ciclo');
 render(<AcademicWorkspace client={api} group={groupContexts([camContext])[0]} onSignOut={()=>{}} />);
 expect(await screen.findByRole('button',{name:/ALVO-25/})).toBeTruthy();
 expect(screen.queryByRole('button',{name:/ALVO-26/})).toBeNull();
 expect(screen.getByText(/Página 1 de 2/)).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Próxima página'}));
 fireEvent.click(await screen.findByRole('button',{name:/ALVO-26 · ausente/}));
 expect(await screen.findByRole('heading',{name:'ALVO-26'})).toBeTruthy();
 expect(filters.at(-1)).toMatchObject({page:2,pageSize:25});
});
it('searches the authorized queue on the server instead of filtering only the loaded page',async()=>{
 const {api,filters}=paged(30);
 openAcademicPage('ciclo');
 render(<AcademicWorkspace client={api} group={groupContexts([camContext])[0]} onSignOut={()=>{}} />);
 await screen.findByRole('button',{name:/ALVO-01/});
 fireEvent.change(screen.getByLabelText('Buscar alvo'),{target:{value:'ALVO-30'}});
 fireEvent.click(screen.getByRole('button',{name:'Buscar'}));
 expect(await screen.findByRole('button',{name:/ALVO-30/})).toBeTruthy();
 expect(filters.at(-1)).toEqual({page:1,pageSize:25,search:'ALVO-30'});
});
it('opens a cycle blocker that is outside the loaded queue page through the authorized detail read',async()=>{
 const {api}=paged(26);
 openAcademicPage('ciclo');
 render(<AcademicWorkspace client={api} group={groupContexts([camContext])[0]} onSignOut={()=>{}} />);
 fireEvent.click(await screen.findByRole('button',{name:'Ver pendência: Envio ausente.'}));
 expect(await screen.findByRole('heading',{name:'ALVO-26'})).toBeTruthy();
});
it('opens a model-3 position whose memory has no factor',async()=>{
 const metaDetail={...detail,position:{...position,inputValue:'90',resultValue:'28.42'},revisions:[{...detail.revisions[0],value:'90'}],memories:[{revisionId:'revision',ruleVersion:1,method:'meta_peso',factor:null,inputValue:'90',resultValue:'28.42'}]};
 const api=client(async url=>String(url).includes('get_operational_positions')?response({items:[metaDetail.position],total:1,page:1,pageSize:25}):response(metaDetail));
 openAcademicPage('conferencia');
 render(<AcademicWorkspace client={api} group={groupContexts([{...context,modelo:3}])[0]} onSignOut={()=>{}} />);
 // T11: the model-3 queue labels a row with the situation in words ("Aguardando conferência"), not the raw status.
 fireEvent.click(await screen.findByRole('button',{name:/NORTE-1 · Aguardando conferência/}));
 expect(await screen.findByText('Synthetic origin')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Iniciar revisão'})).toBeTruthy();
 expect(screen.queryByRole('alert')).toBeNull();
});

// ---- Task 11: model-3 queue with tabs, local search, no bulk action, previous version and explanation ----
const v3Reviewer=(n:number):AuthorizedContext=>({...context,key:`rev-${n}`,vinculoId:`link-${n}`,indicadorId:`indicator-${n}`,modelo:3,escopoCodigo:'ACADEMIC-NORTE',competenciaCodigo:'ACADEMIC-V3-2026-10'});
const v3Group=(role:'revisor_tecnico'|'cam'='revisor_tecnico')=>groupContexts([1,2].map(n=>({...v3Reviewer(n),role})))[0];
const row=(id:string,code:string,status:string,extra:object={})=>({...position,id,escopoCodigo:code,status,revisionId:`rev-${id}`,...extra});
const v3Rows:Record<string,ReturnType<typeof row>[]>={'indicator-1':[row('p1','ALFA','enviada'),row('p2','BETA','em_revisao'),row('p5','EPSILON','ausente',{revisionId:null,estadoDado:null,inputValue:null,resultValue:null})],
 'indicator-2':[row('p3','GAMA','devolvida'),row('p4','DELTA','validada',{resultValue:'28.42'})]};
const v3Revision=(id:string,number:number,value:string,source:string,extra:object={})=>({id,number,authorId:'author',estadoDado:'valor',value,source,sourcePeriod:'2026-10-01',reason:'',submittedAt:'2026-10-20T12:00:00Z',correctionExplanation:null,...extra});
function v3Api(){
 const calls:{name:string;body:{p_position_id:string;p_contexto:{indicadorId:string}}}[]=[];
 const api=client(async(url,options)=>{
  const name=String(url).split('/rpc/')[1];const body=JSON.parse(String(options?.body??'{}'));calls.push({name,body});
  if(name==='get_operational_positions')return response({items:v3Rows[body.p_contexto.indicadorId],total:v3Rows[body.p_contexto.indicadorId].length,page:1,pageSize:100});
  if(name==='get_position_detail'){
   const found=Object.values(v3Rows).flat().find(p=>p.id===body.p_position_id)!;
   const returned=found.id==='p3';
   return response({position:found,revisions:returned?[v3Revision('old',1,'96','Sistema antigo'),v3Revision(`rev-${found.id}`,2,'40','Sistema de chamados',{correctionExplanation:'Usei o mês de outubro.'})]:[v3Revision(`rev-${found.id}`,1,'90','Painel sintético')],
    decisions:[],memories:[{revisionId:`rev-${found.id}`,ruleVersion:1,method:'meta_peso',factor:null,inputValue:returned?'40':'90',resultValue:returned?'25':'28.42'}]});
  }
  return response({resourceId:body.p_position_id,version:4,revisionId:`rev-${body.p_position_id}`,status:name==='start_position_review'?'em_revisao':body.p_decision==='return'?'devolvida':'validada',resultValue:'28.42'});
 });
 return {api,calls};
}
const queue=async(role:'revisor_tecnico'|'cam'='revisor_tecnico')=>{
 const view=v3Api();openAcademicPage(role==='cam'?'entradas':'conferencia');
 render(<AcademicWorkspace client={view.api} group={v3Group(role)} onSignOut={()=>{}}/>);
 await screen.findByRole('tablist',{name:'Filtrar entradas'});
 return view;
};
const tab=(name:RegExp)=>screen.getByRole('tab',{name});
it('V3 reviewer: tabs with counts over every indicator context; Pendentes is the default',async()=>{
 await queue();
 expect(screen.getAllByRole('tab').map(t=>t.textContent)).toEqual(['Pendentes (1)','Em conferência (1)','Devolvidas (1)','Aceitas (1)']);
 expect(tab(/Pendentes/).getAttribute('aria-selected')).toBe('true');
 expect(await screen.findByRole('button',{name:/ALFA · Aguardando conferência/})).toBeTruthy();
 expect(screen.queryByRole('button',{name:/BETA/})).toBeNull();
 fireEvent.click(tab(/Em conferência/));expect(screen.getByRole('button',{name:/BETA · Em conferência/})).toBeTruthy();
 fireEvent.click(tab(/Devolvidas/));expect(screen.getByRole('button',{name:/GAMA · Devolvida/})).toBeTruthy();
 fireEvent.click(tab(/Aceitas/));expect(screen.getByRole('button',{name:/DELTA · Aceita/})).toBeTruthy();
});
it('V3 reviewer: search narrows the list by unit and keeps no bulk action anywhere',async()=>{
 await queue();
 fireEvent.click(tab(/Devolvidas/));
 fireEvent.change(screen.getByLabelText('Buscar unidade'),{target:{value:'zzz'}});fireEvent.click(screen.getByRole('button',{name:'Buscar'}));
 expect(screen.queryByRole('button',{name:/GAMA/})).toBeNull();
 fireEvent.change(screen.getByLabelText('Buscar unidade'),{target:{value:'gam'}});fireEvent.click(screen.getByRole('button',{name:'Buscar'}));
 fireEvent.click(await screen.findByRole('button',{name:/GAMA/}));
 expect(await screen.findByRole('heading',{name:'GAMA'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:/aceitar todos|em massa/i})).toBeNull();
 expect(screen.queryByRole('checkbox')).toBeNull();
});
it('V3 reviewer: shows the previous version next to the correction explanation and the calculation memory',async()=>{
 await queue();fireEvent.click(tab(/Devolvidas/));
 fireEvent.click(await screen.findByRole('button',{name:/GAMA/}));
 expect(await screen.findByText('Usei o mês de outubro.')).toBeTruthy();
 const previous=screen.getByRole('group',{name:'Versão anterior'});
 expect(previous.textContent).toContain('96');expect(previous.textContent).toContain('Sistema antigo');
 const memory=screen.getByRole('group',{name:'Memória de cálculo'});
 expect(memory.textContent).toContain('40');expect(memory.textContent).toContain('25,00');
});
it('V3 reviewer: starts and accepts one item with the context of its own indicator',async()=>{
 const {calls}=await queue();
 fireEvent.click(await screen.findByRole('button',{name:/ALFA/}));
 fireEvent.click(await screen.findByRole('button',{name:'Iniciar revisão'}));
 fireEvent.click(await screen.findByRole('button',{name:'Aceitar evidência'}));
 expect(await screen.findByText('Conferência confirmada: validada.')).toBeTruthy();
 const commands=calls.filter(c=>['start_position_review','review_position'].includes(c.name));
 expect(commands.map(c=>c.name)).toEqual(['start_position_review','review_position']);
 expect(commands.every(c=>c.body.p_position_id==='p1'&&c.body.p_contexto.indicadorId==='indicator-1')).toBe(true);
 // The accepted item leaves Pendentes and the counts follow.
 expect(screen.getAllByRole('tab').map(t=>t.textContent)).toEqual(['Pendentes (0)','Em conferência (1)','Devolvidas (1)','Aceitas (2)']);
});
it('V3 reviewer: a return without a reason is refused before any command',async()=>{
 const {calls}=await queue();fireEvent.click(tab(/Em conferência/));
 fireEvent.click(await screen.findByRole('button',{name:/BETA/}));
 fireEvent.click(await screen.findByRole('button',{name:'Devolver com motivo'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Informe o motivo');
 expect(calls.some(c=>c.name==='review_position')).toBe(false);
});
it('V3 CAM entries: read-only list of every entry, including the ones still absent, with no action',async()=>{
 await queue('cam');
 expect(screen.getAllByRole('tab').map(t=>t.textContent)).toEqual(['Todas (5)','Pendentes (1)','Em conferência (1)','Devolvidas (1)','Aceitas (1)']);
 expect(screen.getByRole('heading',{name:'Todas as entradas'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:/ALFA/}));
 expect(await screen.findByText('Painel sintético')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/Iniciar revisão|Aceitar evidência|Devolver com motivo|Autorizar retificação|Decidir/})).toBeNull();
 expect(screen.queryByLabelText('Motivo da conferência')).toBeNull();
 fireEvent.click(tab(/Todas/));expect(screen.getByRole('button',{name:/EPSILON · Não enviado/})).toBeTruthy();
});
