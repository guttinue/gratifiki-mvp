import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDemoConfiguration, openDemoCompetence, reassignDemoPosition, scheduleDemoRule } from './configurationApi';
import { RuleAdminPage } from './RuleAdminPage';
import { CompetenceAdminPage } from './CompetenceAdminPage';
import { AcademicWorkspace } from '../workspace/AcademicWorkspace';
import type { AuthorizedContext } from '../pilot/types';
import { useState } from 'react';
import { NavigationSafety } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
const context={vinculoId:'admin-link',competenciaId:'october',indicadorId:'demo'};
const assignment={escopoId:'unit',informanteId:'technical',revisorId:'reviewer',aplicavel:true};
function client(rpc:ReturnType<typeof vi.fn>){return{rpc} as unknown as SupabaseClient;}
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-23T01:00:00Z'));});
afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();});
const configuration={competences:[{id:'october',codigo:'ACADEMIC-2026-10',reference:'2026-10-01',state:'aberta',version:3}],positions:[{id:'p',competenceId:'october',escopoId:'unit',informanteId:'technical',revisorId:'reviewer',aplicavel:true,version:2}],rules:[{id:'rule',version:1,factor:'0.8',startMonth:null,reference:null}]};
const catalog={scopes:[{id:'unit',codigo:'DEMO-U',tipo:'distrito',distritoId:null,ativo:true,version:1}],accounts:[{actorId:'technical',label:'Informante fictício',ativo:true},{actorId:'reviewer',label:'Revisor fictício',ativo:true},{actorId:'self',label:'Admin fictício',ativo:true}],links:[{id:'t',actorId:'technical',role:'area_tecnica',escopoId:'unit',indicadorId:'demo',ativo:true,vigenciaInicio:'2026-01-01',vigenciaFim:null,version:1},{id:'r',actorId:'reviewer',role:'revisor_tecnico',escopoId:'unit',indicadorId:'demo',ativo:true,vigenciaInicio:'2026-01-01',vigenciaFim:null,version:1}],indicators:[{id:'demo',codigo:'DEMO-01'}]};
function GuardedConfiguration({api}:{api:SupabaseClient}) {
 const [visible,setVisible]=useState(true);
 return <NavigationSafety>{visible?<><CompetenceAdminPage client={api} context={context} actorId="self"/><button onClick={()=>{if(requestAcademicLeave())setVisible(false);}}>Deixar configuração</button></>:<h2>Outra página</h2>}</NavigationSafety>;
}
describe('future configuration command boundary',()=>{
 it('keeps unsubmitted opening choices protected after a successful reassignment',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const commands:{name:string;args:unknown}[]=[];
  const rpc=vi.fn(async(name:string,args:unknown)=>{
   if(name==='get_admin_catalog')return{data:catalog,error:null};
   if(name==='get_demo_configuration')return{data:configuration,error:null};
   commands.push({name,args});
   return{data:{resourceId:'p',version:3,revisionId:null,status:'reatribuida',resultValue:null},error:null};
  });
  render(<GuardedConfiguration api={client(rpc)}/>);
  expect(await screen.findByLabelText('Informante de DEMO-U')).toHaveProperty('value','technical');
  expect(screen.getByLabelText('Aplicável: DEMO-U')).toHaveProperty('checked',true);
  fireEvent.click(screen.getByLabelText('Aplicável: DEMO-U'));
  fireEvent.change(screen.getByLabelText('Informante de DEMO-U'),{target:{value:''}});
  expect(screen.getByLabelText('Mês da nova competência')).toHaveProperty('value','');
  fireEvent.change(screen.getByLabelText('Posição para reatribuição'),{target:{value:'p'}});
  fireEvent.change(screen.getByLabelText('Motivo da reatribuição'),{target:{value:'Somente reatribuição sintética'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar reatribuição'}));
  await screen.findByText('Configuração confirmada.');
  await screen.findByLabelText('Informante de DEMO-U');
  expect(commands).toHaveLength(1);
  expect(commands[0]).toMatchObject({name:'reassign_demo_position',args:{p_position_id:'p',p_input:{informanteId:'technical',revisorId:'reviewer'}}});
  fireEvent.click(screen.getByRole('button',{name:'Deixar configuração'}));
  expect(screen.queryByRole('heading',{name:'Outra página'})).toBeNull();
  expect(screen.getByLabelText('Aplicável: DEMO-U')).toHaveProperty('checked',false);
  expect(screen.getByLabelText('Informante de DEMO-U')).toHaveProperty('value','');
  expect(screen.getByLabelText('Mês da nova competência')).toHaveProperty('value','');
  expect(confirm).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Deixar configuração'}));
  expect(screen.getByRole('heading',{name:'Outra página'})).toBeTruthy();
 });
 it('does not treat automatically loaded assignment suggestions as unsaved changes',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const rpc=vi.fn(async(name:string)=>({data:name==='get_admin_catalog'?catalog:configuration,error:null}));
  render(<GuardedConfiguration api={client(rpc)}/>);
  await screen.findByLabelText('Informante de DEMO-U');
  fireEvent.click(screen.getByRole('button',{name:'Deixar configuração'}));
  expect(screen.getByRole('heading',{name:'Outra página'})).toBeTruthy();
  expect(confirm).not.toHaveBeenCalled();
 });
 it.each(['checkbox','informant','reviewer'])('protects %s assignment changes before a month is entered',async field=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const choices={...catalog,accounts:[...catalog.accounts,{actorId:'technical2',label:'Outro informante',ativo:true},{actorId:'reviewer2',label:'Outro revisor',ativo:true}],links:[...catalog.links,{...catalog.links[0],id:'t2',actorId:'technical2'},{...catalog.links[1],id:'r2',actorId:'reviewer2'}]};
  const rpc=vi.fn(async(name:string)=>({data:name==='get_admin_catalog'?choices:configuration,error:null}));
  render(<GuardedConfiguration api={client(rpc)}/>);
  await screen.findByLabelText('Informante de DEMO-U');
  const input=screen.getByLabelText(field==='checkbox'?'Aplicável: DEMO-U':field==='informant'?'Informante de DEMO-U':'Revisor de DEMO-U');
  if(field==='checkbox')fireEvent.click(input);
  else fireEvent.change(input,{target:{value:field==='informant'?'technical2':'reviewer2'}});
  expect(screen.getByLabelText('Mês da nova competência')).toHaveProperty('value','');
  fireEvent.click(screen.getByRole('button',{name:'Deixar configuração'}));
  expect(screen.queryByRole('heading',{name:'Outra página'})).toBeNull();
  expect(input).toHaveProperty(field==='checkbox'?'checked':'value',field==='checkbox'?false:field==='informant'?'technical2':'reviewer2');
  expect(confirm).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Deixar configuração'}));
  expect(screen.getByRole('heading',{name:'Outra página'})).toBeTruthy();
 });
 it('excludes expired and future assignments from suggestions and initial selection using the Recife civil date',async()=>{
  const datedCatalog={...catalog,accounts:[
   {actorId:'expired',label:'Vínculo expirado',ativo:true},
   {actorId:'future',label:'Vínculo futuro',ativo:true},
   ...catalog.accounts,
  ],links:[
   {...catalog.links[0],id:'expired',actorId:'expired',vigenciaFim:'2026-10-21'},
   {...catalog.links[1],id:'future',actorId:'future',vigenciaInicio:'2026-10-23'},
   {...catalog.links[0],vigenciaInicio:'2026-10-22',vigenciaFim:'2026-10-22'},
   {...catalog.links[1],vigenciaInicio:'2026-10-22'},
  ]};
  const rpc=vi.fn(async(name:string)=>({data:name==='get_admin_catalog'?datedCatalog:configuration,error:null}));
  render(<CompetenceAdminPage client={client(rpc)} context={context} actorId="self"/>);
  expect(await screen.findByLabelText('Informante de DEMO-U')).toHaveProperty('value','technical');
  expect(screen.getByLabelText('Revisor de DEMO-U')).toHaveProperty('value','reviewer');
  expect(screen.queryByRole('option',{name:'Vínculo expirado'})).toBeNull();
  expect(screen.queryByRole('option',{name:'Vínculo futuro'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Posição para reatribuição'),{target:{value:'p'}});
  expect(screen.getByLabelText('Novo informante')).toHaveProperty('value','technical');
  expect(screen.getByLabelText('Novo revisor')).toHaveProperty('value','reviewer');
  expect(screen.queryByRole('option',{name:'Vínculo expirado'})).toBeNull();
  expect(screen.queryByRole('option',{name:'Vínculo futuro'})).toBeNull();
 });
 it('decodes assignment metadata only and rejects unknown workflow states',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{...configuration,results:['do-not-project']},error:null});
  expect(await loadDemoConfiguration(client(rpc),context)).toEqual(configuration);
  rpc.mockResolvedValue({data:{...configuration,competences:[{...configuration.competences[0],state:'paid'}]},error:null});
  await expect(loadDemoConfiguration(client(rpc),context)).rejects.toMatchObject({code:'invalid_input'});
 });
 it('rejects non-first day and self review before issuing an opening command',async()=>{
  const rpc=vi.fn();
  await expect(openDemoCompetence(client(rpc),context,'2026-11-02',[assignment],'op')).rejects.toMatchObject({code:'invalid_input'});
  await expect(openDemoCompetence(client(rpc),context,'2026-11-01',[{...assignment,revisorId:'technical'}],'op')).rejects.toMatchObject({code:'invalid_input'});
  expect(rpc).not.toHaveBeenCalled();
 });
 it('opens an explicit universe without accepting client actor or role in context',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{resourceId:'november',version:1,revisionId:null,status:'aberta',resultValue:null},error:null});
  expect((await openDemoCompetence(client(rpc),{...context,actorId:'spoof'} as never,'2026-11-01',[assignment],'op')).resourceId).toBe('november');
  expect(rpc).toHaveBeenCalledWith('open_demo_competence',{p_contexto:context,p_reference:'2026-11-01',p_assignments:[assignment],p_operation_id:'op'});
 });
 it('normalizes factor and reference without floating point calculation',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{resourceId:'rule-v2',version:2,revisionId:null,status:'agendada',resultValue:null},error:null});
  await scheduleDemoRule(client(rpc),context,'0,750000','2026-11-01',' DEMO-APROVACAO-V2 ','op');
  expect(rpc).toHaveBeenCalledWith('schedule_demo_rule',{p_contexto:context,p_factor:'0.75',p_start_month:'2026-11-01',p_reference:'DEMO-APROVACAO-V2',p_operation_id:'op'});
 });
 it('rejects malformed success as ambiguous and preserves resource-specific checks',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{resourceId:'other-position',version:3,revisionId:null,status:'reatribuida',resultValue:null},error:null});
  await expect(reassignDemoPosition(client(rpc),context,'position',2,assignment,' Troca sintética ','op')).rejects.toMatchObject({confirmedRejected:false});
 });
 it('retains the exact future-rule operation after a lost response',async()=>{
  const payloads:unknown[]=[];let calls=0;
  const rpc=vi.fn(async(_name:string,args:unknown)=>{payloads.push(args);return ++calls===1?{data:null,error:{message:'lost'}}:{data:{resourceId:'rule',version:2,revisionId:null,status:'agendada',resultValue:null},error:null};});
  render(<RuleAdminPage client={client(rpc)} context={context}/>);
  fireEvent.change(screen.getByLabelText('Fator sintético futuro'),{target:{value:'0,75'}});
  fireEvent.change(screen.getByLabelText('Primeiro mês da versão'),{target:{value:'2026-11-01'}});
  fireEvent.change(screen.getByLabelText('Referência de aprovação de demonstração'),{target:{value:'DEMO-APROVACAO-V2'}});
  fireEvent.click(screen.getByRole('button',{name:'Agendar regra futura'}));
  fireEvent.click(await screen.findByRole('button',{name:'Repetir agendamento pendente'}));
  await screen.findByText('Versão futura agendada. Competências anteriores preservadas.');
  expect(payloads[1]).toEqual(payloads[0]);
 });
 it('opens the complete visible universe, excludes self and retries identical assignments after lost response',async()=>{
  const payloads:unknown[]=[];let calls=0;
  const rpc=vi.fn(async(name:string,args:unknown)=>{if(name==='get_admin_catalog')return{data:catalog,error:null};if(name==='get_demo_configuration')return{data:configuration,error:null};payloads.push(args);return ++calls===1?{data:null,error:{message:'lost'}}:{data:{resourceId:'november',version:1,revisionId:null,status:'aberta',resultValue:null},error:null};});
  render(<CompetenceAdminPage client={client(rpc)} context={context} actorId="self"/>);
  await screen.findByLabelText('Informante de DEMO-U');
  expect(screen.queryByRole('option',{name:'Admin fictício'})).toBeNull();
  fireEvent.change(screen.getByLabelText('Mês da nova competência'),{target:{value:'2026-11-01'}});
  fireEvent.click(screen.getByRole('button',{name:'Abrir competência de demonstração'}));
  fireEvent.click(await screen.findByRole('button',{name:'Repetir configuração pendente'}));
  await screen.findByText('Configuração confirmada.');expect(payloads[1]).toEqual(payloads[0]);
  expect(payloads[0]).toMatchObject({p_assignments:[assignment]});
 });
 it('discards an old configuration command completion after changing the authenticated host context',async()=>{
  let finish!:(value:unknown)=>void;
  const rpc=vi.fn(async(name:string)=>{if(name==='get_admin_catalog')return{data:catalog,error:null};if(name==='get_demo_configuration')return{data:configuration,error:null};return new Promise(resolve=>{finish=resolve;});});
  const oldContext:AuthorizedContext={...context,key:'old-admin-context',actorId:'self',role:'administrador',escopoId:'unit',escopoCodigo:'DEMO-U',competenciaCodigo:'ACADEMIC-2026-10',mode:'academic'};
  const view=render(<AcademicWorkspace client={client(rpc)} context={oldContext} onSignOut={()=>{}}/>);
  fireEvent.click(screen.getByRole('button',{name:'Competências e atribuições'}));await screen.findByLabelText('Informante de DEMO-U');
  fireEvent.change(screen.getByLabelText('Mês da nova competência'),{target:{value:'2026-11-01'}});fireEvent.click(screen.getByRole('button',{name:'Abrir competência de demonstração'}));await waitFor(()=>expect(typeof finish).toBe('function'));
  view.rerender(<AcademicWorkspace client={client(rpc)} context={{...oldContext,key:'new-admin-context',competenciaId:'november',competenciaCodigo:'ACADEMIC-2026-11'}} onSignOut={()=>{}}/>);
  await act(async()=>{finish({data:{resourceId:'november',version:1,revisionId:null,status:'aberta',resultValue:null},error:null});});
  expect(screen.getByText('Perfil administrador · DEMO-U · ACADEMIC-2026-11')).toBeTruthy();
  expect(screen.queryByText('Configuração confirmada.')).toBeNull();expect(screen.queryByRole('button',{name:'Repetir configuração pendente'})).toBeNull();
 });
});
