import { groupContexts } from '../context/contextGroups';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
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
 const line=await screen.findByRole('row',{name:/NORTE-1/});expect(line.textContent).toContain('Aguardando conferência');
 fireEvent.click(within(line).getByRole('button',{name:'NORTE-1'}));
 expect(await screen.findByText('Synthetic origin')).toBeTruthy();
 expect(screen.getByRole('button',{name:'Iniciar revisão'})).toBeTruthy();
 expect(screen.queryByRole('alert')).toBeNull();
});

// ---- Model-3 queue (V4 Conferência, RV-05 to RV-09, CAM-08): tabs, unit chips, live search, side detail, row actions ----
const v3Reviewer=(n:number):AuthorizedContext=>({...context,key:`rev-${n}`,vinculoId:`link-${n}`,indicadorId:`indicator-${n}`,modelo:3,escopoCodigo:'ACADEMIC-NORTE',competenciaCodigo:'ACADEMIC-V3-2026-10'});
const v3Group=(role:'revisor_tecnico'|'cam'='revisor_tecnico',count=2)=>groupContexts(Array.from({length:count},(_,n)=>({...v3Reviewer(n+1),role})))[0];
const row=(id:string,code:string,status:string,extra:object={})=>({...position,id,escopoId:code,escopoCodigo:code,status,revisionId:`rev-${id}`,indicatorCode:'DEMO-V1-01',indicatorName:'Registros conferidos',...extra});
const v3Rows:Record<string,ReturnType<typeof row>[]>={'indicator-1':[row('p1','ALFA','enviada'),row('p2','BETA','em_revisao'),row('p5','EPSILON','ausente',{revisionId:null,estadoDado:null,inputValue:null,resultValue:null})],
 'indicator-2':[row('p3','GAMA','devolvida'),row('p4','DELTA','validada',{resultValue:'28.42'})]};
const v3Revision=(id:string,number:number,value:string,source:string,extra:object={})=>({id,number,authorId:'author@example.test',estadoDado:'valor',value,source,sourcePeriod:'2026-10-01',reason:'',submittedAt:'2026-10-20T12:00:00Z',correctionExplanation:null,...extra});
// The decisions carry an actor id that looks like an e-mail: the detail must never show it.
const v3Decisions=(found:{id:string;status:string})=>{
 const decision=(type:string,reason:string,occurredAt:string)=>({id:`${type}-${found.id}`,revisionId:`rev-${found.id}`,actorId:'reviewer@example.test',type,reason,reference:null,occurredAt});
 const started=decision('iniciar_revisao','','2026-10-21T13:00:00Z');
 return found.status==='em_revisao'?[started]:found.status==='devolvida'?[started,decision('devolver','Confirme a fonte.','2026-10-22T13:00:00Z')]:found.status==='validada'?[started,decision('validar','','2026-10-22T13:00:00Z')]:[];
};
// loseReview: the first review_position fails at the network, so its outcome is unknown.
function v3Api(rows=v3Rows,{loseReview=false}={}){
 const calls:{name:string;body:{p_position_id:string;p_contexto:{indicadorId:string};p_decision?:string;p_operation_id?:string}}[]=[];
 let lose=loseReview;
 const api=client(async(url,options)=>{
  const name=String(url).split('/rpc/')[1];const body=JSON.parse(String(options?.body??'{}'));calls.push({name,body});
  if(name==='get_operational_positions')return response({items:rows[body.p_contexto.indicadorId],total:rows[body.p_contexto.indicadorId].length,page:1,pageSize:100});
  if(name==='get_position_detail'){
   const found=Object.values(rows).flat().find(p=>p.id===body.p_position_id)!;
   const returned=found.id==='p3';
   return response({indicator:{code:found.indicatorCode,name:found.indicatorName,meta:'95',direction:'maior_melhor',weight:'30',unit:'%'},previous:found.id==='p4'?null:{competencia:'ACADEMIC-V3-2026-09',valor:'88',estadoDado:'valor'},position:found,revisions:returned?[v3Revision('old',1,'96','Sistema antigo'),v3Revision(`rev-${found.id}`,2,'40','Sistema de chamados',{correctionExplanation:'Usei o mês de outubro.'})]:[v3Revision(`rev-${found.id}`,1,'90','Painel sintético')],
    decisions:v3Decisions(found),memories:[{revisionId:`rev-${found.id}`,ruleVersion:1,method:'meta_peso',factor:null,inputValue:returned?'40':'90',resultValue:returned?'25':'28.42'}]});
  }
  if(name==='review_position'&&lose){lose=false;throw new TypeError('Failed to fetch');}
  return response({resourceId:body.p_position_id,version:4,revisionId:`rev-${body.p_position_id}`,status:name==='start_position_review'?'em_revisao':body.p_decision==='return'?'devolvida':'validada',resultValue:'28.42'});
 });
 return {api,calls};
}
const queue=async(role:'revisor_tecnico'|'cam'='revisor_tecnico',rows=v3Rows,options={})=>{
 const view=v3Api(rows,options);openAcademicPage(role==='cam'?'entradas':'conferencia');
 // StrictMode replays mount effects, so a command fired from one would run twice (preflight F9).
 render(<StrictMode><AcademicWorkspace client={view.api} group={v3Group(role,Object.keys(rows).length)} onSignOut={()=>{}}/></StrictMode>);
 await screen.findByRole('tablist',{name:'Filtrar entradas'});
 await screen.findByRole('group',{name:'Filtrar por unidade'});
 return view;
};
const tab=(name:RegExp)=>screen.getByRole('tab',{name});
const tabTexts=()=>screen.getAllByRole('tab').map(t=>t.textContent?.replace(/\s+/g,' ').trim());
const entries=()=>screen.getAllByRole('row').slice(1).map(line=>line.querySelector('.row-link')!.textContent);
const openDetail=()=>screen.getByRole('complementary',{name:/ · /});
const commands=<T extends {name:string}>(calls:T[])=>calls.filter(c=>['save_position_draft','submit_unit_batch','start_position_review','review_position'].includes(c.name));
// The row's own link (chips and row actions also carry the unit name).
const rowLink=async(name:RegExp)=>(await screen.findByRole('row',{name})).querySelector<HTMLButtonElement>('.row-link')!;
const settle=()=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,30));});
// The named fixture: the 4 DEMO units × the 4 DEMO indicators, one context per indicator.
// Alfa · DEMO-V1-02 waits, Beta · DEMO-V1-01 is being reviewed, the other 14 are accepted.
const demoIndicators=[['DEMO-V1-01','Registros conferidos'],['DEMO-V1-02','Rotinas concluídas'],['DEMO-V1-03','Tempo de resposta'],['DEMO-V1-04','Verificações realizadas']];
const demoUnits=['ACADEMIC-NORTE-1','ACADEMIC-NORTE-2','ACADEMIC-SUL-1','ACADEMIC-SUL-2'];
const demoStatus:Record<string,string>={'ACADEMIC-NORTE-1:DEMO-V1-02':'enviada','ACADEMIC-NORTE-2:DEMO-V1-01':'em_revisao'};
const named=(statuses=demoStatus)=>Object.fromEntries(demoIndicators.map(([code,name],n)=>[`indicator-${n+1}`,demoUnits.map((unit,u)=>
 row(`d${n}${u}`,unit,statuses[`${unit}:${code}`]??'validada',{indicatorCode:code,indicatorName:name,inputValue:'90',resultValue:'28.4'}))]));
const namedRows=named();
it('V3: tabs follow the V4 order with counts',async()=>{
 await queue('revisor_tecnico',namedRows);
 expect(tabTexts()).toEqual(['Para conferir 1','Em conferência 1','Devolvidas 0','Aceitas 14','Todas 16']);
 expect(tab(/^Para conferir/).getAttribute('aria-selected')).toBe('true');
 expect(screen.getByRole('tab',{name:'Para conferir 1'})).toBeTruthy();
 cleanup();
 // CAM-08 (preflight F10: a variant with one absent and one draft entry).
 await queue('cam',named({...demoStatus,'ACADEMIC-SUL-1:DEMO-V1-03':'ausente','ACADEMIC-SUL-2:DEMO-V1-04':'rascunho'}));
 expect(tabTexts()).toEqual(['Todas 16','Não enviadas 2','Para conferir 1','Em conferência 1','Devolvidas 0','Aceitas 12']);
 expect(tab(/^Todas/).getAttribute('aria-selected')).toBe('true');
});
it('V3 reviewer: lists entries in the V4 columns, in unit and indicator order',async()=>{
 await queue('revisor_tecnico',namedRows);
 fireEvent.click(tab(/^Todas/));
 const table=screen.getByRole('table',{name:'Entradas: Todas'});
 expect(within(table).getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual(['Entrada','Valor','Situação','Ações']);
 expect(entries().slice(0,5)).toEqual(['Unidade Alfa DEMO-V1-01 · Registros conferidos','Unidade Alfa DEMO-V1-02 · Rotinas concluídas','Unidade Alfa DEMO-V1-03 · Tempo de resposta','Unidade Alfa DEMO-V1-04 · Verificações realizadas','Unidade Beta DEMO-V1-01 · Registros conferidos']);
 const line=screen.getByRole('row',{name:/Unidade Alfa DEMO-V1-02/});
 expect(within(line).getAllByRole('cell').map(cell=>[cell.getAttribute('data-label'),cell.textContent])).toEqual([['Entrada','Unidade Alfa DEMO-V1-02 · Rotinas concluídas'],['Valor','90'],['Situação','Aguardando conferência'],['Ações','']]);
 expect(within(line).getByText('Aguardando conferência').className).toContain('v3-st-enviada');
 expect(screen.getByText('16 entradas')).toBeTruthy();expect(screen.getByText('Ordem: unidade e indicador')).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Buscar'})).toBeNull();
 fireEvent.click(await rowLink(/Unidade Alfa DEMO-V1-02/));
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-02 · Rotinas concluídas'});
 expect(within(aside).getByText('Unidade Alfa').className).toContain('eyebrow');
 expect(within(aside).getByRole('heading',{level:3}).getAttribute('tabindex')).toBe('-1');
 expect(screen.getByRole('row',{name:/Unidade Alfa DEMO-V1-02/}).getAttribute('aria-current')).toBe('true');
 expect(screen.getAllByRole('row').filter(line=>line.hasAttribute('aria-current'))).toHaveLength(1);
 expect(table.closest('.review')).toBeTruthy();
 fireEvent.click(within(aside).getByRole('button',{name:'Fechar detalhe'}));
 expect(screen.queryByRole('complementary',{name:/DEMO-V1-02/})).toBeNull();
});
it('V3 reviewer: unit chips and live search filter without closing the detail',async()=>{
 await queue('revisor_tecnico',namedRows);
 fireEvent.click(tab(/^Todas/));
 fireEvent.click(await rowLink(/Unidade Alfa DEMO-V1-02/));
 await screen.findByRole('complementary',{name:'DEMO-V1-02 · Rotinas concluídas'});
 const chips=screen.getByRole('group',{name:'Filtrar por unidade'});
 expect(within(chips).getAllByRole('button').map(chip=>chip.textContent)).toEqual(['Todas as unidades','Unidade Alfa','Unidade Beta','Unidade Gama','Unidade Delta']);
 expect(within(chips).getByRole('button',{name:'Todas as unidades'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(within(chips).getByRole('button',{name:'Unidade Beta'}));
 expect(within(chips).getByRole('button',{name:'Unidade Beta'}).getAttribute('aria-pressed')).toBe('true');
 expect(new Set(entries().map(text=>text?.split(' DEMO')[0]))).toEqual(new Set(['Unidade Beta']));
 expect(tabTexts()).toEqual(['Para conferir 0','Em conferência 1','Devolvidas 0','Aceitas 3','Todas 4']);
 expect(screen.getByRole('complementary',{name:'DEMO-V1-02 · Rotinas concluídas'})).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Buscar unidade ou indicador'),{target:{value:'rotinas'}});
 expect(entries()).toEqual(['Unidade Beta DEMO-V1-02 · Rotinas concluídas']);
 expect(screen.getByRole('complementary',{name:'DEMO-V1-02 · Rotinas concluídas'})).toBeTruthy();
 fireEvent.click(within(chips).getByRole('button',{name:'Todas as unidades'}));
 expect(entries()).toHaveLength(4);
});
it('V3 reviewer: searches by unit name, unit code and indicator, ignoring case',async()=>{
 await queue('revisor_tecnico',namedRows);
 fireEvent.click(tab(/^Todas/));
 const search=(text:string)=>fireEvent.change(screen.getByLabelText('Buscar unidade ou indicador'),{target:{value:text}});
 const units=()=>entries().map(text=>text?.split(' DEMO')[0]);
 search('beta');expect(units()).toEqual(['Unidade Beta','Unidade Beta','Unidade Beta','Unidade Beta']);
 search('academic-sul-2');expect(new Set(units())).toEqual(new Set(['Unidade Delta']));
 search('TEMPO');expect(units()).toHaveLength(4);
 search('demo-v1-04');expect(screen.getByText('4 entradas')).toBeTruthy();
});
it('V3 reviewer: opening an entry is a read',async()=>{
 const {calls}=await queue('revisor_tecnico',namedRows);
 const before=calls.length;
 fireEvent.click(await rowLink(/Unidade Alfa DEMO-V1-02/));
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-02 · Rotinas concluídas'});
 await settle();
 expect(calls.slice(before).map(c=>c.name)).toEqual(['get_position_detail']);
 expect(within(aside).getAllByText('Aguardando conferência').length).toBeGreaterThan(0);
 expect(screen.getByRole('row',{name:/Unidade Alfa DEMO-V1-02/}).textContent).toContain('Aguardando conferência');
 expect(within(aside).getByRole('button',{name:'Iniciar revisão'})).toBeTruthy();
 expect(within(aside).queryByRole('button',{name:'Aceitar evidência'})).toBeNull();
});
it('V3 reviewer: detail shows facts, memory and approval flow by role, never a person',async()=>{
 await queue('revisor_tecnico',namedRows);
 fireEvent.click(tab(/^Em conferência/));
 fireEvent.click(await rowLink(/Unidade Beta DEMO-V1-01/));
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 const fact=(term:string)=>within(aside).getByText(term,{selector:'dt'}).nextElementSibling?.textContent;
 expect(fact('Meta')).toBe('≥ 95 % · peso 30');
 expect(fact('Informado')).toBe('90 %');
 expect(fact('Fonte')).toBe('Painel sintético');
 expect(fact('Período')).toBe('01/10/2026');
 expect(fact('Setembro')).toBe('88 %');
 expect(within(aside).getByText('revisão 1')).toBeTruthy();
 expect(within(aside).getByRole('heading',{name:'Memória de cálculo'}).nextElementSibling?.textContent).toBe('min(90 ÷ 95; 1) × 30 = 28,42 pontos');
 const flow=within(aside).getByRole('heading',{name:'Fluxo de aprovação'}).nextElementSibling!;
 expect(within(flow as HTMLElement).getAllByRole('listitem').map(step=>step.textContent)).toEqual(['Enviado pela área técnicarevisão 1 · 20/10/2026','Em conferência · revisor técnico21/10/2026']);
 expect(aside.textContent).not.toContain('@');expect(aside.textContent).not.toContain('validar:');expect(aside.textContent).not.toContain('Estado:');
 // Footer: the reason (required only to return), return and accept.
 expect(screen.getByLabelText('Motivo da conferência').getAttribute('aria-describedby')).toBeTruthy();
 expect(within(aside).getByText('obrigatório para devolver')).toBeTruthy();
 expect(within(aside).getByRole('button',{name:'Devolver com motivo'}).className).toContain('danger');
 expect(within(aside).getByRole('button',{name:'Aceitar evidência'}).className).toContain('primary');
});
it('V3 reviewer: a returned entry shows its correction, its reason and the flow back to the technical area',async()=>{
 await queue();fireEvent.click(tab(/^Devolvidas/));
 fireEvent.click(await rowLink(/GAMA/));
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 expect(within(aside).getByText('Correção',{selector:'dt'}).nextElementSibling?.textContent).toBe('Usei o mês de outubro.');
 expect(within(aside).getByRole('heading',{name:'Memória de cálculo'}).nextElementSibling?.textContent).toBe('min(40 ÷ 95; 1) × 30 = 25,00 pontos');
 expect(aside.querySelector('.notice.danger')?.textContent).toBe('Motivo da devolução. Confirme a fonte.');
 const steps=within(within(aside).getByRole('list')).getAllByRole('listitem');
 expect(steps.map(step=>step.querySelector('strong')?.textContent)).toEqual(['Enviado pela área técnica','Devolvido pelo revisor técnico','Correção · área técnica']);
 expect(aside.querySelector('.detail-foot')?.textContent).toBe('Aguardando a correção da área técnica.');
});
it('V3 reviewer: shows the previous version next to the correction explanation',async()=>{
 await queue();fireEvent.click(tab(/^Devolvidas/));
 fireEvent.click(await rowLink(/GAMA/));
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 const terms=[...aside.querySelectorAll('dt')].map(term=>term.textContent);
 // R-25: the replaced version sits right before what the technician says they corrected.
 expect(terms.slice(terms.indexOf('Revisão 1'),terms.indexOf('Revisão 1')+2)).toEqual(['Revisão 1','Correção']);
 expect(within(aside).getByText('Revisão 1',{selector:'dt'}).nextElementSibling?.textContent).toBe('96 % · Sistema antigo');
 expect(within(aside).getByText('Informado',{selector:'dt'}).nextElementSibling?.textContent).toBe('40 %');
 cleanup();
 // Without a correction there is no previous-version fact.
 await queue();fireEvent.click(await rowLink(/ALFA/));
 const first=await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 expect(within(first).queryByText(/^Revisão \d/,{selector:'dt'})).toBeNull();
});
it('V3 reviewer: a typed reason asks before Fechar or a row action on another row drops it',async()=>{
 const {calls}=await queue('revisor_tecnico',named({...demoStatus,'ACADEMIC-NORTE-1:DEMO-V1-01':'em_revisao'}));
 fireEvent.click(tab(/^Em conferência/));
 fireEvent.click(await rowLink(/Unidade Beta DEMO-V1-01/));
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 fireEvent.change(within(aside).getByLabelText('Motivo da conferência'),{target:{value:'Fonte de setembro.'}});
 const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
 fireEvent.click(within(aside).getByRole('button',{name:'Fechar detalhe'}));
 expect(confirm).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button',{name:'Aceitar Unidade Alfa DEMO-V1-01'}));
 expect(confirm).toHaveBeenCalledTimes(2);
 await settle();
 // Both were cancelled: the same detail keeps the reason, and nothing ran.
 expect(within(screen.getByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'})).getByText('Unidade Beta')).toBeTruthy();
 expect((screen.getByLabelText('Motivo da conferência') as HTMLTextAreaElement).value).toBe('Fonte de setembro.');
 expect(commands(calls)).toHaveLength(0);
 confirm.mockReturnValue(true);
 fireEvent.click(screen.getByRole('button',{name:'Fechar detalhe'}));
 expect(screen.queryByRole('complementary',{name:/DEMO-V1-01/})).toBeNull();
 confirm.mockRestore();
});
it('V3 reviewer: without an accepted value last month the detail omits the month',async()=>{
 await queue();fireEvent.click(tab(/^Aceitas/));
 fireEvent.click(await rowLink(/DELTA/));
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 expect(within(aside).queryByText('Setembro')).toBeNull();
 expect(within(aside).getAllByRole('listitem').at(-1)?.querySelector('strong')?.textContent).toBe('Aceito pelo revisor técnico · conta no resultado');
});
it('V3 reviewer: tabs with counts over every indicator context; Para conferir is the default',async()=>{
 await queue();
 expect(tabTexts()).toEqual(['Para conferir 1','Em conferência 1','Devolvidas 1','Aceitas 1','Todas 5']);
 expect((await screen.findByRole('row',{name:/ALFA/})).textContent).toContain('Aguardando conferência');
 expect(screen.queryByRole('row',{name:/BETA/})).toBeNull();
 fireEvent.click(tab(/^Em conferência/));expect(screen.getByRole('row',{name:/BETA/}).textContent).toContain('Em conferência');
 fireEvent.click(tab(/^Devolvidas/));expect(screen.getByRole('row',{name:/GAMA/}).textContent).toContain('Devolvida');
 fireEvent.click(tab(/^Aceitas/));expect(screen.getByRole('row',{name:/DELTA/}).textContent).toContain('Aceita');
});
it('V3 reviewer: search narrows the list by unit and keeps no bulk action anywhere',async()=>{
 await queue();
 fireEvent.click(tab(/^Devolvidas/));
 fireEvent.change(screen.getByLabelText('Buscar unidade ou indicador'),{target:{value:'zzz'}});
 expect(screen.queryByRole('row',{name:/GAMA/})).toBeNull();
 expect(screen.getByText('Nenhuma entrada aqui')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Buscar unidade ou indicador'),{target:{value:'gam'}});
 fireEvent.click(await rowLink(/GAMA/));
 expect(within(await screen.findByRole('complementary',{name:/DEMO-V1-01/})).getByText('GAMA')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/aceitar todos|em massa/i})).toBeNull();
 expect(screen.queryByRole('checkbox')).toBeNull();
});
it('V3 reviewer: starts and accepts one item with the context of its own indicator; the tab follows the situation',async()=>{
 const {calls}=await queue();
 fireEvent.click(await rowLink(/ALFA/));
 fireEvent.click(await screen.findByRole('button',{name:'Iniciar revisão'}));
 expect(await screen.findByText('Conferência confirmada: em_revisao.')).toBeTruthy();
 expect(tab(/^Em conferência/).getAttribute('aria-selected')).toBe('true');
 fireEvent.click(await screen.findByRole('button',{name:'Aceitar evidência'}));
 expect(await screen.findByText('Conferência confirmada: validada.')).toBeTruthy();
 expect(commands(calls).map(c=>c.name)).toEqual(['start_position_review','review_position']);
 expect(commands(calls).every(c=>c.body.p_position_id==='p1'&&c.body.p_contexto.indicadorId==='indicator-1')).toBe(true);
 expect(tabTexts()).toEqual(['Para conferir 0','Em conferência 1','Devolvidas 1','Aceitas 2','Todas 5']);
 expect(tab(/^Aceitas/).getAttribute('aria-selected')).toBe('true');
 expect(openDetail().textContent).toContain('Entrada aceita. Ela já conta no resultado.');
});
it('V3 reviewer: a return without a reason is refused before any command',async()=>{
 const {calls}=await queue();fireEvent.click(tab(/^Em conferência/));
 fireEvent.click(await rowLink(/BETA/));
 fireEvent.click(await screen.findByRole('button',{name:'Devolver com motivo'}));
 expect((await screen.findByRole('alert')).textContent).toContain('Informe o motivo');
 expect(calls.some(c=>c.name==='review_position')).toBe(false);
});
it('V3 reviewer: accept in the row runs the same accept once',async()=>{
 const {calls}=await queue('revisor_tecnico',namedRows);
 fireEvent.click(tab(/^Em conferência/));
 const before=calls.length;
 fireEvent.click(screen.getByRole('button',{name:'Aceitar Unidade Beta DEMO-V1-01'}));
 expect(await screen.findByText('Conferência confirmada: validada.')).toBeTruthy();
 await settle();
 const after=calls.slice(before);
 expect(after.filter(c=>c.name==='get_position_detail')).toHaveLength(1);
 const reviews=after.filter(c=>c.name==='review_position');
 expect(reviews).toHaveLength(1);
 expect(reviews[0].body).toMatchObject({p_decision:'accept',p_position_id:'d01'});
 expect(commands(after)).toHaveLength(1);
 expect(tabTexts()).toEqual(['Para conferir 1','Em conferência 0','Devolvidas 0','Aceitas 15','Todas 16']);
});
it('V3 reviewer: an ambiguous row accept keeps the pending key and does not retry by itself',async()=>{
 const {calls}=await queue('revisor_tecnico',namedRows,{loseReview:true});
 fireEvent.click(tab(/^Em conferência/));
 fireEvent.click(screen.getByRole('button',{name:'Aceitar Unidade Beta DEMO-V1-01'}));
 const retry=await screen.findByRole('button',{name:'Repetir operação pendente'});
 await settle();
 const reviews=()=>calls.filter(c=>c.name==='review_position');
 expect(reviews()).toHaveLength(1);
 expect(screen.getByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'})).toBeTruthy();
 expect((screen.getByRole('button',{name:'Aceitar evidência'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(retry);
 expect(await screen.findByText('Conferência confirmada: validada.')).toBeTruthy();
 expect(reviews()).toHaveLength(2);
 expect(reviews()[1].body).toEqual(reviews()[0].body);
 expect(reviews()[0].body).toMatchObject({p_decision:'accept'});
 expect(reviews()[0].body.p_operation_id).toBeTruthy();
});
it('V3 reviewer: return in the row focuses the reason and runs no command',async()=>{
 const {calls}=await queue('revisor_tecnico',namedRows);
 fireEvent.click(tab(/^Em conferência/));
 fireEvent.click(screen.getByRole('button',{name:'Devolver Unidade Beta DEMO-V1-01'}));
 await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 await waitFor(()=>expect(document.activeElement).toBe(screen.getByLabelText('Motivo da conferência')));
 await settle();
 expect(commands(calls)).toHaveLength(0);
});
it('V3 reviewer: row actions only on entries in review',async()=>{
 await queue('revisor_tecnico',namedRows);
 fireEvent.click(tab(/^Todas/));
 expect(screen.getAllByRole('button',{name:/^Aceitar /}).map(button=>button.getAttribute('aria-label'))).toEqual(['Aceitar Unidade Beta DEMO-V1-01']);
 expect(screen.getAllByRole('button',{name:/^Devolver /}).map(button=>button.getAttribute('aria-label'))).toEqual(['Devolver Unidade Beta DEMO-V1-01']);
});
it('V3 CAM reads every entry read-only',async()=>{
 const {calls}=await queue('cam',namedRows);
 expect(tab(/^Todas/).getAttribute('aria-selected')).toBe('true');
 expect(screen.getByText('16 entradas')).toBeTruthy();
 expect(screen.getAllByRole('heading',{name:'Todas as entradas'})).toHaveLength(1);
 expect(within(screen.getByRole('table')).getAllByRole('columnheader').map(cell=>cell.textContent)).toEqual(['Entrada','Valor','Situação']);
 expect(screen.queryByRole('button',{name:/^(Aceitar|Devolver) /})).toBeNull();
 fireEvent.click(await rowLink(/Unidade Beta DEMO-V1-01/));
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 expect(screen.queryByRole('button',{name:'Aceitar evidência'})).toBeNull();
 expect(screen.queryByLabelText('Motivo da conferência')).toBeNull();
 expect(aside.querySelector('.detail-foot')?.textContent).toBe('Somente leitura. A conferência é do revisor técnico de cada distrito.');
 await settle();
 expect(commands(calls)).toHaveLength(0);
});
it('V3 CAM entries: read-only list of every entry, including the ones still absent, with no action',async()=>{
 await queue('cam');
 expect(tabTexts()).toEqual(['Todas 5','Não enviadas 1','Para conferir 1','Em conferência 1','Devolvidas 1','Aceitas 1']);
 expect(tab(/^Todas/).getAttribute('aria-selected')).toBe('true');
 fireEvent.click(await rowLink(/ALFA/));
 expect(await screen.findByText('Painel sintético')).toBeTruthy();
 expect(screen.queryByRole('button',{name:/Iniciar revisão|Aceitar evidência|Devolver com motivo|Autorizar retificação|Decidir/})).toBeNull();
 expect(screen.queryByLabelText('Motivo da conferência')).toBeNull();
 expect(screen.getByRole('row',{name:/EPSILON/}).textContent).toContain('Não enviado');
 fireEvent.click(tab(/^Não enviadas/));
 expect(entries()).toEqual(['EPSILON DEMO-V1-01 · Registros conferidos']);
});
it('V3 reviewer: a "Conferir" to-do on the painel opens that entry in the tab of its status',async()=>{
 const rows={'indicator-1':[row('q1','ACADEMIC-NORTE-1','em_revisao'),row('q2','ACADEMIC-NORTE-2','enviada')]};
 const view=v3Api(rows);openAcademicPage('painel');
 render(<AcademicWorkspace client={view.api} group={v3Group('revisor_tecnico',1)} onSignOut={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Conferir DEMO-V1-01 · Unidade Alfa'}));
 expect(window.location.hash).toBe('#academico/conferencia');
 const aside=await screen.findByRole('complementary',{name:'DEMO-V1-01 · Registros conferidos'});
 expect(within(aside).getByText('Unidade Alfa')).toBeTruthy();
 expect(tab(/^Em conferência/).getAttribute('aria-selected')).toBe('true');
 expect(screen.getByRole('row',{name:/Unidade Alfa/}).getAttribute('aria-current')).toBe('true');
 expect(document.activeElement).toBe(within(aside).getByRole('heading',{level:3}));
 expect(commands(view.calls)).toHaveLength(0);
});
