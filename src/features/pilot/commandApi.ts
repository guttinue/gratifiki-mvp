import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, CommandReceipt, DomainErrorCode } from './types';

const messages:Record<DomainErrorCode,string>={
 access_denied:'Seu acesso a esta operação não está disponível.',invalid_input:'Os dados ou a resposta da operação são inválidos.',
 version_conflict:'A versão mudou. Atualize a consulta antes de tentar novamente.',operation_payload_mismatch:'Esta tentativa não corresponde à operação pendente.',
 invalid_state:'Esta posição não permite a operação neste estado.',rule_unavailable:'A regra sintética fixada não está disponível.',
 network_error:'Não foi possível confirmar a operação. Tente novamente com a mesma chave.',
};
export class DomainCommandError extends Error {
 readonly code:DomainErrorCode;
 readonly confirmedRejected:boolean;
 constructor(code:DomainErrorCode,confirmedRejected=false){super(messages[code]);this.name='DomainCommandError';this.code=code;this.confirmedRejected=confirmedRejected;}
}
function safeError(error:unknown):DomainCommandError {
 const row=error&&typeof error==='object'?error as Record<string,unknown>:{};
 if(row.code==='42501')return new DomainCommandError('access_denied',true);
 if(row.code==='40001')return new DomainCommandError('version_conflict',true);
 if(row.code==='55000')return new DomainCommandError('invalid_state',true);
 if(row.code==='22023')return new DomainCommandError(row.message==='operation_payload_mismatch'?'operation_payload_mismatch':row.message==='rule_unavailable'?'rule_unavailable':'invalid_input',true);
 return new DomainCommandError('network_error');
}
export function decodeCommandReceipt(value:unknown):CommandReceipt {
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DomainCommandError('invalid_input');
 const row=value as Record<string,unknown>;
 if(typeof row.resourceId!=='string'||!row.resourceId.trim()||typeof row.version!=='number'||!Number.isSafeInteger(row.version)||row.version<1||
  !(row.revisionId===null||(typeof row.revisionId==='string'&&!!row.revisionId.trim()))||typeof row.status!=='string'||!row.status.trim()||
  !(row.resultValue===null||(typeof row.resultValue==='string'&&/^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/.test(row.resultValue))))throw new DomainCommandError('invalid_input');
 return {resourceId:row.resourceId,version:row.version,revisionId:row.revisionId as string|null,status:row.status,resultValue:row.resultValue as string|null};
}
// Receipt callers retain the default protocol. A different protocol must supply
// its own decoder; a type parameter alone can never validate untrusted JSON.
// Retain the old receipt type argument only for source compatibility: callers
// still receive exactly CommandReceipt, never an unchecked requested subtype.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function runCommand<T extends CommandReceipt=CommandReceipt>(client:SupabaseClient,rpc:string,context:CommandContext,args:Record<string,unknown>,operationId:string):Promise<CommandReceipt>;
export function runCommand<T>(client:SupabaseClient,rpc:string,context:CommandContext,args:Record<string,unknown>,operationId:string,decoder:(value:unknown)=>T):Promise<T>;
export async function runCommand<T>(client:SupabaseClient,rpc:string,context:CommandContext,args:Record<string,unknown>,operationId:string,decoder?:(value:unknown)=>T):Promise<T|CommandReceipt> {
 let response;
 try {response=await client.rpc(rpc,{...args,p_contexto:{vinculoId:context.vinculoId,competenciaId:context.competenciaId,indicadorId:context.indicadorId},p_operation_id:operationId});}
 catch(error){throw safeError(error);}
 if(response.error)throw safeError(response.error);
 return decoder?decoder(response.data):decodeCommandReceipt(response.data);
}
