import type { Role } from '../pilot/types';
export type ScopeInput={codigo:string;tipo:'unidade'|'distrito';distritoId:string|null;ativo:boolean};
export type BusinessLinkInput={role:Exclude<Role,'administrador'>;escopoId:string;indicadorId:string;ativo:boolean;vigenciaInicio:string;vigenciaFim:string|null};
export type AdminScope=ScopeInput&{id:string;version:number};
export type AdminLink=Omit<BusinessLinkInput,'role'>&{id:string;actorId:string;role:Role;version:number};
export type AdminCatalog={scopes:AdminScope[];accounts:{actorId:string;label:string;ativo:boolean}[];links:AdminLink[];indicators:{id:string;codigo:string}[]};
