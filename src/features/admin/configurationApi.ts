import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandReceipt, DecimalText } from '../pilot/types';
import { DomainCommandError, runCommand } from '../pilot/commandApi';
import { parseFactor } from '../pilot/decimal';
import { readArray, readDecimal, readInteger, readNullableText, readObject, readRpc, readText } from '../workspace/academicDashboardApi';
export type AssignmentInput={escopoId:string;informanteId:string;revisorId:string;aplicavel:boolean};
export type DemoConfiguration={
 competences:{id:string;codigo:string;reference:string;state:'aberta'|'em_consolidacao'|'fechada';version:number}[];
 positions:(AssignmentInput&{id:string;competenceId:string;version:number})[];
 rules:{id:string;version:number;factor:string;startMonth:string|null;reference:string|null}[];
};
export async function loadDemoConfiguration(client:SupabaseClient,context:CommandContext):Promise<DemoConfiguration>{
 const r=readObject(await readRpc(client,'get_demo_configuration',context));
 const data:DemoConfiguration={competences:readArray(r.competences,value=>{const c=readObject(value);if(!['aberta','em_consolidacao','fechada'].includes(String(c.state)))throw new DomainCommandError('invalid_input');return{id:readText(c.id),codigo:readText(c.codigo),reference:month(readText(c.reference)),state:c.state as DemoConfiguration['competences'][number]['state'],version:readInteger(c.version,1)};}),
  positions:readArray(r.positions,value=>{const p=readObject(value);if(typeof p.aplicavel!=='boolean'||p.informanteId===p.revisorId)throw new DomainCommandError('invalid_input');return{id:readText(p.id),competenceId:readText(p.competenceId),escopoId:readText(p.escopoId),informanteId:readText(p.informanteId),revisorId:readText(p.revisorId),aplicavel:p.aplicavel,version:readInteger(p.version,1)};}),
  rules:readArray(r.rules,value=>{const rule=readObject(value),factor=readDecimal(rule.factor);if(factor===null||parseFactor(factor)!==factor)throw new DomainCommandError('invalid_input');return{id:readText(rule.id),version:readInteger(rule.version,1),factor,startMonth:rule.startMonth===null?null:month(readText(rule.startMonth)),reference:readNullableText(rule.reference)};})};
 if([data.competences,data.positions,data.rules].some(items=>new Set(items.map(i=>i.id)).size!==items.length)||data.positions.some(p=>!data.competences.some(c=>c.id===p.competenceId)))throw new DomainCommandError('invalid_input');return data;
}
function invalid():never{throw new DomainCommandError('invalid_input',true);}
function month(text:string):string{if(!/^\d{4}-\d{2}-01$/.test(text)||Number.isNaN(Date.parse(text+'T00:00:00Z'))||new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text)return invalid();return text;}
function receipt(value:CommandReceipt,status:string,id?:string){if(value.status!==status||value.revisionId!==null||value.resultValue!==null||(id&&value.resourceId!==id))throw new DomainCommandError('invalid_input');return value;}
export async function openDemoCompetence(client:SupabaseClient,context:CommandContext,reference:string,assignments:AssignmentInput[],operationId:string):Promise<CommandReceipt>{
 month(reference);if(!assignments.length||new Set(assignments.map(a=>a.escopoId)).size!==assignments.length||assignments.some(a=>a.informanteId===a.revisorId))return invalid();
 return receipt(await runCommand(client,'open_demo_competence',context,{p_reference:reference,p_assignments:assignments.map(a=>({escopoId:a.escopoId,informanteId:a.informanteId,revisorId:a.revisorId,aplicavel:a.aplicavel}))},operationId),'aberta');
}
export async function reassignDemoPosition(client:SupabaseClient,context:CommandContext,positionId:string,expectedVersion:number,input:Pick<AssignmentInput,'informanteId'|'revisorId'>,reason:string,operationId:string):Promise<CommandReceipt>{
 if(input.informanteId===input.revisorId||!reason.trim()||reason.trim().length>1000)return invalid();
 return receipt(await runCommand(client,'reassign_demo_position',context,{p_position_id:positionId,p_expected_version:expectedVersion,p_input:{informanteId:input.informanteId,revisorId:input.revisorId},p_reason:reason.trim()},operationId),'reatribuida',positionId);
}
export async function scheduleDemoRule(client:SupabaseClient,context:CommandContext,factor:DecimalText,startMonth:string,reference:string,operationId:string):Promise<CommandReceipt>{
 month(startMonth);let normalized:string;try{normalized=parseFactor(factor);}catch{return invalid();}if(!reference.trim()||reference.trim().length>500)return invalid();
 return receipt(await runCommand(client,'schedule_demo_rule',context,{p_factor:normalized,p_start_month:startMonth,p_reference:reference.trim()},operationId),'agendada');
}
