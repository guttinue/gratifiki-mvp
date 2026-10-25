import { describe,expect,it } from 'vitest';
import { academicPendingStorageKey,clearAcademicPending,loadAcademicPending,saveAcademicPending,pendingEntryStorageKey,savePendingEntry,loadPendingEntry } from './pendingEntry';
const scope={actorId:'actor',vinculoId:'link',competenciaId:'month',indicadorId:'indicator',positionId:'position'};
const operation={operationId:'00000000-0000-4000-8000-000000000001',expectedVersion:2};
function storage(){const values=new Map<string,string>();return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);},removeItem:(key:string)=>{values.delete(key);}};}
describe('academic pending identity',()=>{
 it('retains the original operation/version and isolates all five identity dimensions',()=>{
  const target=storage();saveAcademicPending(scope,operation,target);
  expect(loadAcademicPending(scope,target)).toEqual(operation);
  for(const key of ['actorId','vinculoId','competenciaId','indicadorId','positionId'] as const)expect(loadAcademicPending({...scope,[key]:'other'},target)).toBeNull();
  expect(()=>saveAcademicPending(scope,{...operation,expectedVersion:3},target)).toThrow();
  expect(()=>clearAcademicPending(scope,'00000000-0000-4000-8000-000000000002',target)).toThrow();
  clearAcademicPending(scope,operation.operationId,target);expect(loadAcademicPending(scope,target)).toBeNull();
 });
 it('fails closed when persistence silently fails before network submission',()=>{
  const target={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  expect(()=>saveAcademicPending(scope,operation,target)).toThrow();
 });
 it.each(['read','write','remove'])('propagates %s failures instead of generating a new operation',phase=>{
  const target=storage();saveAcademicPending(scope,operation,target);
  const broken={...target,[phase==='read'?'getItem':phase==='write'?'setItem':'removeItem']:()=>{throw new Error('private');}};
  expect(()=>phase==='remove'?clearAcademicPending(scope,operation.operationId,broken):phase==='read'?loadAcademicPending(scope,broken):saveAcademicPending({...scope,positionId:'new'},operation,broken)).toThrow('Pending operation state is unavailable');
 });
 it('rejects malformed or mismatched stored identity without reading it as another context',()=>{
  const target=storage();target.setItem(academicPendingStorageKey(scope),JSON.stringify({...scope,...operation,actorId:'other',version:2}));
  expect(()=>loadAcademicPending(scope,target)).toThrow();
 });
 it('keeps the legacy v1 key and data independently intact',()=>{
  const target=storage();const legacy={actorId:'actor',competenciaId:'month',indicadorId:'indicator',escopoId:'scope'};
  expect(pendingEntryStorageKey(legacy)).toBe('gratifiki:pending-entry:v1:actor:month:indicator:scope');
  savePendingEntry(legacy,{operationId:operation.operationId,valueText:'10'},target);saveAcademicPending(scope,operation,target);
  clearAcademicPending(scope,operation.operationId,target);
  expect(loadPendingEntry(legacy,target)).toEqual({operationId:operation.operationId,valueText:'10'});
 });
});
