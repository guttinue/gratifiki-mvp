// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { runSuiteBatch } from './suites.ts';
describe('fresh owned suite batches',()=>{
 it('runs DB once then each E2E in a new project sequentially, returning actual identities',async()=>{
  let active=0;const calls:string[]=[];
  const result=await runSuiteBatch({suite:'all',fixture:'academic'},['b.spec.ts','a.spec.ts'],async request=>{
   expect(active++).toBe(0);calls.push(request.file??'db');await Promise.resolve();active--;
   return {exitCode:0,projectId:`owned-${calls.length}`};
  });
  expect(calls).toEqual(['db','b.spec.ts','a.spec.ts']);
  expect(result).toEqual({exitCode:0,projectId:'owned-1',projects:[{suite:'db',projectId:'owned-1'},{suite:'e2e',file:'b.spec.ts',projectId:'owned-2'},{suite:'e2e',file:'a.spec.ts',projectId:'owned-3'}]});
 });
 it('stops before allocating another project on failed test or failed cleanup',async()=>{
  let calls=0;
  const result=await runSuiteBatch({suite:'e2e',fixture:'academic'},['a','b'],async()=>({exitCode:++calls,projectId:'failed'}));
  expect(result.exitCode).toBe(1);expect(calls).toBe(1);
  calls=0;
  await expect(runSuiteBatch({suite:'e2e',fixture:'academic'},['a','b'],async()=>{calls++;throw Error('cleanup incomplete');})).rejects.toThrow('cleanup incomplete');expect(calls).toBe(1);
 });
 it('preserves a selected single-file run and its return contract',async()=>{
  const requests:unknown[]=[];
  const result=await runSuiteBatch({suite:'e2e',fixture:'academic',file:'one.spec.ts'},['other'],async request=>{requests.push(request);return {exitCode:0,projectId:'one'};});
  expect(requests).toEqual([{suite:'e2e',fixture:'academic',file:'one.spec.ts'}]);expect(result).toEqual({exitCode:0,projectId:'one'});
 });
});
