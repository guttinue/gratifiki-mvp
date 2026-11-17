import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAdminCatalog, saveDemoScope, setDemoBusinessLink } from './adminApi';
import { ScopeAdminPage } from './ScopeAdminPage';
import { AccessAdminPage } from './AccessAdminPage';
import type { AdminCatalog } from './adminTypes';
import { useState, type ReactNode } from 'react';
import { NavigationSafety } from '../workspace/NavigationSafety';
import { requestAcademicLeave } from '../workspace/academicNavigation';
const context={vinculoId:'admin-link',competenciaId:'month',indicadorId:'indicator'};
const catalog:AdminCatalog={scopes:[{id:'d',codigo:'DEMO-D',tipo:'distrito',distritoId:null,ativo:true,version:1},{id:'u',codigo:'DEMO-U',tipo:'unidade',distritoId:'d',ativo:true,version:3}],accounts:[{actorId:'other',label:'Conta sintética',ativo:true},{actorId:'self',label:'Admin sintético',ativo:true}],links:[{id:'l',actorId:'other',role:'area_tecnica',escopoId:'u',indicadorId:'indicator',ativo:true,vigenciaInicio:'2026-01-01',vigenciaFim:null,version:2}],indicators:[{id:'indicator',codigo:'DEMO-01'}]};
function client(rpc:ReturnType<typeof vi.fn>){return{rpc} as unknown as SupabaseClient;}
afterEach(()=>{cleanup();vi.restoreAllMocks();});
function GuardedAdmin({children}:{children:ReactNode}) {
 const [visible,setVisible]=useState(true);
 return <NavigationSafety>{visible?<>{children}<button onClick={()=>{if(requestAcademicLeave())setVisible(false);}}>Deixar formulário</button></>:<h2>Outra página</h2>}</NavigationSafety>;
}
describe('administrative metadata boundary',()=>{
 it('protects a new scope edit after a successful save, cancelling preserves it and accepting leaves',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const rpc=vi.fn(async(name:string)=>name==='get_admin_catalog'?{data:catalog,error:null}:{data:{resourceId:'new',version:1,revisionId:null,status:'ativo',resultValue:null},error:null});
  render(<GuardedAdmin><ScopeAdminPage client={client(rpc)} context={context}/></GuardedAdmin>);
  fireEvent.change(await screen.findByLabelText('Código do escopo'),{target:{value:'DEMO-SAVED'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar escopo'}));
  await screen.findByText('Cadastro salvo.');
  fireEvent.change(screen.getByLabelText('Código do escopo'),{target:{value:'UNSAVED-AFTER-SUCCESS'}});
  fireEvent.click(screen.getByRole('button',{name:'Deixar formulário'}));
  expect(screen.getByLabelText('Código do escopo')).toHaveProperty('value','UNSAVED-AFTER-SUCCESS');
  expect(screen.queryByText('Cadastro salvo.')).toBeNull();
  expect(confirm).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button',{name:'Deixar formulário'}));
  expect(screen.getByRole('heading',{name:'Outra página'})).toBeTruthy();
 });
 it.each(['same','other'])('guards replacing an unsaved scope with the %s catalogue record',async target=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  render(<GuardedAdmin><ScopeAdminPage client={client(vi.fn().mockResolvedValue({data:catalog,error:null}))} context={context}/></GuardedAdmin>);
  fireEvent.click(await screen.findByRole('button',{name:'Editar DEMO-D'}));
  fireEvent.change(screen.getByLabelText('Código do escopo'),{target:{value:'LOCAL-SCOPE'}});
  const edit=screen.getByRole('button',{name:target==='same'?'Editar DEMO-D':'Editar DEMO-U'});
  fireEvent.click(edit);
  expect(screen.getByLabelText('Código do escopo')).toHaveProperty('value','LOCAL-SCOPE');
  expect(confirm).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);fireEvent.click(edit);
  expect(screen.getByLabelText('Código do escopo')).toHaveProperty('value',target==='same'?'DEMO-D':'DEMO-U');
 });
 it.each(['same','other'])('guards replacing an unsaved business link with the %s catalogue record',async target=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  const twoLinks:AdminCatalog={...catalog,accounts:[...catalog.accounts,{actorId:'third',label:'Outra conta',ativo:true}],links:[...catalog.links,{...catalog.links[0],id:'second',actorId:'third',escopoId:'d'}]};
  render(<GuardedAdmin><AccessAdminPage client={client(vi.fn().mockResolvedValue({data:twoLinks,error:null}))} context={context} actorId="self"/></GuardedAdmin>);
  fireEvent.click(await screen.findByRole('button',{name:'Editar vínculo Conta sintética · area_tecnica · DEMO-U'}));
  fireEvent.change(screen.getByLabelText('Início da vigência'),{target:{value:'2026-03-01'}});
  const edit=screen.getByRole('button',{name:target==='same'?'Editar vínculo Conta sintética · area_tecnica · DEMO-U':'Editar vínculo Outra conta · area_tecnica · DEMO-D'});
  fireEvent.click(edit);
  expect(screen.getByLabelText('Conta de demonstração')).toHaveProperty('value','other');
  expect(screen.getByLabelText('Início da vigência')).toHaveProperty('value','2026-03-01');
  expect(confirm).toHaveBeenCalledTimes(1);
  confirm.mockReturnValue(true);fireEvent.click(edit);
  expect(screen.getByLabelText('Conta de demonstração')).toHaveProperty('value',target==='same'?'other':'third');
  expect(screen.getByLabelText('Início da vigência')).toHaveProperty('value','2026-01-01');
 });
 it('projects only known catalogue fields and rejects malformed link roles',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{...catalog,password:'secret',accounts:[{...catalog.accounts[0],email:'hidden@example.invalid'}]},error:null});
  const data=await loadAdminCatalog(client(rpc),context);
  expect(data).not.toHaveProperty('password');expect(data.accounts[0]).not.toHaveProperty('email');
  rpc.mockResolvedValue({data:{...catalog,links:[{...catalog.links[0],role:'unknown'}]},error:null});
  await expect(loadAdminCatalog(client(rpc),context)).rejects.toMatchObject({code:'invalid_input'});
 });
 it('normalizes scope input and validates resource-specific receipts',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{resourceId:'u',version:4,revisionId:null,status:'ativo',resultValue:null},error:null});
  expect((await saveDemoScope(client(rpc),context,'u',3,{codigo:' DEMO-U ',tipo:'unidade',distritoId:'d',ativo:true},'op')).version).toBe(4);
  expect(rpc).toHaveBeenCalledWith('save_demo_scope',{p_contexto:context,p_scope_id:'u',p_expected_version:3,p_input:{codigo:'DEMO-U',tipo:'unidade',distritoId:'d',ativo:true},p_operation_id:'op'});
  rpc.mockResolvedValue({data:{resourceId:'wrong',version:4,revisionId:null,status:'ativo',resultValue:null},error:null});
  await expect(saveDemoScope(client(rpc),context,'u',3,{codigo:'DEMO-U',tipo:'unidade',distritoId:'d',ativo:true},'op')).rejects.toMatchObject({confirmedRejected:false});
 });
 it('uses business link payload without changing Auth or accepting an administrator role',async()=>{
  const rpc=vi.fn().mockResolvedValue({data:{resourceId:'l',version:3,revisionId:null,status:'inativo',resultValue:null},error:null});
  await setDemoBusinessLink(client(rpc),context,'other',2,{role:'area_tecnica',escopoId:'u',indicadorId:'indicator',ativo:false,vigenciaInicio:'2026-01-01',vigenciaFim:null},'op');
  expect(rpc.mock.calls[0][0]).toBe('set_demo_business_link');
  await expect(setDemoBusinessLink(client(rpc),context,'other',0,{role:'administrador',escopoId:'u',indicadorId:'indicator',ativo:true,vigenciaInicio:'2026-01-01',vigenciaFim:null} as never,'new')).rejects.toMatchObject({code:'invalid_input'});
 });
 it('retains the exact scope command after an ambiguous response and reloads durable metadata',async()=>{
  let calls=0;const payloads:unknown[]=[];
  const rpc=vi.fn(async(name:string,args:unknown)=>{
   if(name==='get_admin_catalog')return{data:catalog,error:null};
   payloads.push(args);return ++calls===1?{data:null,error:{message:'lost'}}:{data:{resourceId:'u',version:4,revisionId:null,status:'ativo',resultValue:null},error:null};
  });
  render(<ScopeAdminPage client={client(rpc)} context={context}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Editar DEMO-U'}));
  fireEvent.change(screen.getByLabelText('Código do escopo'),{target:{value:'DEMO-RENAMED'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar escopo'}));
  fireEvent.click(await screen.findByRole('button',{name:'Repetir cadastro pendente'}));
  await screen.findByText('Cadastro salvo.');expect(payloads[1]).toEqual(payloads[0]);
 });
 it('excludes self and administrator from link choices while rendering existing business links',async()=>{
  render(<AccessAdminPage client={client(vi.fn().mockResolvedValue({data:catalog,error:null}))} context={context} actorId="self"/>);
  await screen.findByRole('button',{name:'Editar vínculo Conta sintética · area_tecnica · DEMO-U'});
  expect(screen.queryByRole('option',{name:'Admin sintético'})).toBeNull();expect(screen.queryByRole('option',{name:'administrador'})).toBeNull();
 });
 it('lists the business links in a table with role, scope and situation names, keeping the edit button name',async()=>{
  const academic:AdminCatalog={...catalog,scopes:[{id:'alfa',codigo:'ACADEMIC-NORTE-1',tipo:'unidade',distritoId:'d',ativo:true,version:1}],accounts:[{actorId:'tech',label:'Conta acadêmica area_tecnica',ativo:true}],
   links:[{...catalog.links[0],actorId:'tech',escopoId:'alfa'},{...catalog.links[0],id:'off',actorId:'tech',escopoId:'alfa',role:'revisor_tecnico',ativo:false,version:4}],indicators:[{id:'indicator',codigo:'DEMO-V1-01'}]};
  render(<AccessAdminPage client={client(vi.fn().mockResolvedValue({data:academic,error:null}))} context={context} actorId="self"/>);
  const edit=await screen.findByRole('button',{name:'Editar vínculo Conta acadêmica area_tecnica · area_tecnica · ACADEMIC-NORTE-1'});
  const table=screen.getByRole('table');
  expect(within(table).getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['Pessoa','Papel','Escopo','Indicador','Situação','Versão','Ação']);
  const row=edit.closest('tr') as HTMLElement;
  expect(within(row).getAllByRole('cell').slice(0,6).map(c=>c.textContent)).toEqual(['Conta acadêmica area_tecnica','Área técnica','Unidade Alfa','DEMO-V1-01','Ativo','2']);
  expect(within(table).getByText('Inativo')).toBeTruthy();
  expect(within(table).getByText('Revisor técnico')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Salvar vínculo'}).className).toContain('primary');
 });
 const academicCatalog=():AdminCatalog=>({...catalog,scopes:[{id:'alfa',codigo:'ACADEMIC-NORTE-1',tipo:'unidade',distritoId:'d',ativo:true,version:1}],accounts:[{actorId:'tech',label:'Conta acadêmica area_tecnica',ativo:true}],
 links:[{...catalog.links[0],actorId:'tech',escopoId:'alfa'},{...catalog.links[0],id:'off',actorId:'tech',escopoId:'alfa',role:'revisor_tecnico',ativo:false,version:4}],indicators:[{id:'indicator',codigo:'DEMO-V1-01'}]});
const v4Page=()=>render(<GuardedAdmin><AccessAdminPage v4 client={client(vi.fn().mockResolvedValue({data:academicCatalog(),error:null}))} context={context} actorId="self"/></GuardedAdmin>);
// Model 3 names the role and scope like the table does (spec §8.3: no ACADEMIC- code on screen); model 2 keeps the codes.
const editName='Editar vínculo Conta acadêmica area_tecnica · Área técnica · Unidade Alfa';
describe('model-3 business links',()=>{
 it('links table shows a status badge and keeps the edit name',async()=>{
  v4Page();
  const edit=await screen.findByRole('button',{name:editName});
  const table=screen.getByRole('table');
  // AD-05 removes the version column from the table (it stays in the form); this replaces the model-2 assertion that ended with the version cell.
  expect(within(table).getAllByRole('columnheader').map(h=>h.textContent)).toEqual(['Pessoa','Papel','Escopo','Indicador','Situação','Ação']);
  const row=edit.closest('tr') as HTMLElement;
  expect(within(row).getAllByRole('cell').slice(0,5).map(c=>c.textContent)).toEqual(['Conta acadêmica area_tecnica','Área técnica','Unidade Alfa','DEMO-V1-01','Ativo']);
  expect(within(row).getByText('Ativo').className).toContain('t-ok');
  expect(within(table).getByText('Inativo').className).toContain('t-neutral');
  expect(screen.getByText('1 vínculo ativo')).toBeTruthy();
 });
 it('shows no scope code, even with the form open',async()=>{
  v4Page();
  fireEvent.click(await screen.findByRole('button',{name:'Novo vínculo'}));
  expect(within(screen.getByLabelText('Escopo do vínculo')).getByRole('option',{name:'Unidade Alfa'})).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/@|ACADEMIC-/);
 });
 it('form opens from Novo vínculo and from Editar',async()=>{
  v4Page();
  const novo=await screen.findByRole('button',{name:'Novo vínculo'});
  expect(screen.queryByLabelText('Conta de demonstração')).toBeNull();
  expect(novo.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(novo);
  expect(novo.getAttribute('aria-expanded')).toBe('true');
  expect(novo.getAttribute('aria-controls')).toBe(screen.getByRole('group',{name:'Conceder, atualizar ou revogar vínculo'}).closest('form')?.id);
  expect(document.activeElement).toBe(screen.getByLabelText('Conta de demonstração'));
  expect(within(screen.getByLabelText('Papel de negócio')).getByRole('option',{name:'Área técnica'})).toBeTruthy();
  fireEvent.click(novo);
  expect(screen.queryByLabelText('Conta de demonstração')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:editName}));
  expect(screen.getByLabelText('Papel de negócio')).toHaveProperty('value','area_tecnica');
  expect(screen.getByRole('option',{name:'Área técnica',selected:true})).toBeTruthy();
  expect(screen.getByLabelText('Conta de demonstração')).toHaveProperty('value','tech');
  expect(document.activeElement).toBe(screen.getByLabelText('Conta de demonstração'));
 });
 it('closing a dirty form asks first',async()=>{
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);
  v4Page();
  const novo=await screen.findByRole('button',{name:'Novo vínculo'});
  fireEvent.click(novo);
  fireEvent.change(screen.getByLabelText('Início da vigência'),{target:{value:'2026-03-01'}});
  fireEvent.click(novo);
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Início da vigência')).toHaveProperty('value','2026-03-01');
  confirm.mockReturnValue(true);fireEvent.click(novo);
  expect(screen.queryByLabelText('Início da vigência')).toBeNull();
 });
});
it('preserves a revoked ambiguous link attempt, payload and version on retry',async()=>{
  const payloads:unknown[]=[];let calls=0;
  const rpc=vi.fn(async(name:string,args:unknown)=>{if(name==='get_admin_catalog')return{data:catalog,error:null};payloads.push(args);return ++calls===1?{data:null,error:{code:'42501',message:'private database detail'}}:{data:{resourceId:'l',version:3,revisionId:null,status:'inativo',resultValue:null},error:null};});
  render(<AccessAdminPage client={client(rpc)} context={context} actorId="self"/>);
  fireEvent.click(await screen.findByRole('button',{name:'Editar vínculo Conta sintética · area_tecnica · DEMO-U'}));
  fireEvent.click(screen.getByLabelText('Vínculo ativo'));fireEvent.click(screen.getByRole('button',{name:'Salvar vínculo'}));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent','Seu acesso a esta operação não está disponível.');
  expect(screen.getByLabelText('Vínculo ativo').matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Repetir vínculo pendente'}));await screen.findByText('Vínculo salvo.');
  expect(payloads[1]).toEqual(payloads[0]);expect(payloads[0]).toMatchObject({p_expected_version:2,p_input:{ativo:false}});
 });
 it('keeps edits after confirmed version conflict and allows refreshing',async()=>{
  const rpc=vi.fn(async(name:string)=>name==='get_admin_catalog'?{data:catalog,error:null}:{data:null,error:{code:'40001'}});
  render(<ScopeAdminPage client={client(rpc)} context={context}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Editar DEMO-U'}));fireEvent.change(screen.getByLabelText('Código do escopo'),{target:{value:'LOCAL-EDIT'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar escopo'}));await screen.findByRole('alert');
  expect((screen.getByLabelText('Código do escopo') as HTMLInputElement).value).toBe('LOCAL-EDIT');
  expect((screen.getByRole('button',{name:'Atualizar cadastros'}) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('button',{name:'Repetir cadastro pendente'})).toBeNull();
 });
 it('discards a late catalogue when unmounted',async()=>{
  let resolve!:(value:unknown)=>void;const promise=new Promise(r=>{resolve=r;});
  const view=render(<ScopeAdminPage client={client(vi.fn().mockReturnValue(promise))} context={context}/>);view.unmount();
  resolve({data:catalog,error:null});await waitFor(()=>expect(screen.queryByText('DEMO-U')).toBeNull());
 });
});
