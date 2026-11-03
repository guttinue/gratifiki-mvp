import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandReceipt, Role } from '../pilot/types';
import { DomainCommandError, runCommand } from '../pilot/commandApi';
import { readArray, readInteger, readNullableText, readObject, readRpc, readText } from '../workspace/academicDashboardApi';
import type { AdminCatalog, BusinessLinkInput, ScopeInput } from './adminTypes';
import { decodeRuleCatalog, type RuleCatalog } from '../results/resultsApi';
export const businessRoles:Exclude<Role,'administrador'>[]=['area_tecnica','revisor_tecnico','cam','gestor_unidade','gestor_distrital','lideranca'];
function invalid():never{throw new DomainCommandError('invalid_input');}
function boolean(value:unknown):boolean{return typeof value==='boolean'?value:invalid();}
function date(value:unknown):string{const text=readText(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||Number.isNaN(Date.parse(text+'T00:00:00Z'))||new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text)return invalid();return text;}
export async function loadAdminCatalog(client:SupabaseClient,context:CommandContext):Promise<AdminCatalog>{
 const c=readObject(await readRpc(client,'get_admin_catalog',context));
 return{scopes:readArray(c.scopes,value=>{const s=readObject(value);if(s.tipo!=='unidade'&&s.tipo!=='distrito')return invalid();return{id:readText(s.id),codigo:readText(s.codigo),tipo:s.tipo,distritoId:readNullableText(s.distritoId),ativo:boolean(s.ativo),version:readInteger(s.version,1)};}),
  accounts:readArray(c.accounts,value=>{const a=readObject(value);return{actorId:readText(a.actorId),label:readText(a.label),ativo:boolean(a.ativo)};}),
  links:readArray(c.links,value=>{const l=readObject(value);if(l.role!=='administrador'&&!businessRoles.includes(l.role as never))return invalid();return{id:readText(l.id),actorId:readText(l.actorId),role:l.role as Role,escopoId:readText(l.escopoId),indicadorId:readText(l.indicadorId),ativo:boolean(l.ativo),vigenciaInicio:date(l.vigenciaInicio),vigenciaFim:l.vigenciaFim===null?null:date(l.vigenciaFim),version:readInteger(l.version,1)};}),
  indicators:readArray(c.indicators,value=>{const i=readObject(value);return{id:readText(i.id),codigo:readText(i.codigo)};})};
}
// Read-only DEMO rule catalogue (administrator and CAM); there is no rule command.
export async function loadRuleCatalog(client:SupabaseClient,context:CommandContext):Promise<RuleCatalog>{
 return decodeRuleCatalog(await readRpc(client,'get_rule_catalog',context));
}
function metadataReceipt(receipt:CommandReceipt,active:boolean,resourceId?:string|null){if(receipt.status!==(active?'ativo':'inativo')||receipt.revisionId!==null||receipt.resultValue!==null||(resourceId&&receipt.resourceId!==resourceId))return invalid();return receipt;}
export async function saveDemoScope(client:SupabaseClient,context:CommandContext,scopeId:string|null,expectedVersion:number,input:ScopeInput,operationId:string):Promise<CommandReceipt>{
 const normalized={codigo:input.codigo.trim(),tipo:input.tipo,distritoId:input.distritoId,ativo:input.ativo};
 return metadataReceipt(await runCommand(client,'save_demo_scope',context,{p_scope_id:scopeId,p_expected_version:expectedVersion,p_input:normalized},operationId),input.ativo,scopeId);
}
export async function setDemoBusinessLink(client:SupabaseClient,context:CommandContext,actorId:string,expectedVersion:number,input:BusinessLinkInput,operationId:string):Promise<CommandReceipt>{
 if(!businessRoles.includes(input.role))return invalid();
 return metadataReceipt(await runCommand(client,'set_demo_business_link',context,{p_actor_id:actorId,p_expected_version:expectedVersion,p_input:{role:input.role,escopoId:input.escopoId,indicadorId:input.indicadorId,ativo:input.ativo,vigenciaInicio:input.vigenciaInicio,vigenciaFim:input.vigenciaFim}},operationId),input.ativo);
}
