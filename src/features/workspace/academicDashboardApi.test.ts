import { describe,it,expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDashboard } from './academicDashboardApi';
import { loadEvaluations } from '../evaluation/evaluationApi';
import { loadLeadershipAggregates } from '../leadership/leadershipApi';
import { loadAudit } from '../audit/auditApi';
const context={vinculoId:'v',competenciaId:'c',indicadorId:'i'};
function client(data:unknown):SupabaseClient{return {rpc:async()=>({data,error:null})} as unknown as SupabaseClient;}
describe('academic read boundaries',()=>{
 it('decodes reconciled authorized counters and rejects impossible totals',async()=>{
  expect(await loadDashboard(client({expected:2,received:2,reviewed:1,unavailable:1,cards:[]}),context)).toMatchObject({expected:2,reviewed:1});
  await expect(loadDashboard(client({expected:1,received:2,reviewed:1,unavailable:0,cards:[]}),context)).rejects.toThrow();
 });
 it('does not return actor or position identifiers in leadership aggregates',async()=>{
  const [aggregate]=await loadLeadershipAggregates(client([{competencia:'2026-10',distritoCodigo:'NORTE',unidadeMedida:'pontos sintéticos',publishedUnits:2,calculableUnits:2,resultSum:'17.6',actorId:'secret',positionId:'secret'}]),context);
  expect(aggregate.resultSum).toBe('17.6');expect(Object.keys(aggregate)).not.toEqual(expect.arrayContaining(['actorId','positionId']));
 });
 it('keeps evaluations preliminary and excludes internal fields',async()=>{
  const result=await loadEvaluations(client({items:[{id:'p',escopoId:'s',escopoCodigo:'ALFA',escopoTipo:'unidade',estadoDado:'valor',inputValue:'10',resultValue:'8',ruleVersion:1,publication:'preliminar',snapshotId:null,factor:'0.8',unidadeMedida:'pontos sintéticos',actorId:'secret'}],total:1,page:1,pageSize:25}),context,'own',{page:1,pageSize:25});
  expect(result.items[0].resultValue).toBe('8');expect(result.items[0]).not.toHaveProperty('actorId');
 });
 it('rejects invalid page metadata and strips non-contract audit values',async()=>{
  await expect(loadAudit(client({items:[],total:0,page:0,pageSize:25}),context,{page:1,pageSize:25})).rejects.toThrow();
  const result=await loadAudit(client({items:[{id:'a',occurredAt:'2026-10-20T12:00:00Z',action:'vinculo_demo_alterado',resourceId:'v',version:1,reason:null,inputValue:'100',actorId:'secret'}],total:1,page:1,pageSize:25}),context,{page:1,pageSize:25});
  expect(result.items[0]).not.toHaveProperty('inputValue');expect(result.items[0]).not.toHaveProperty('actorId');
 });
});
