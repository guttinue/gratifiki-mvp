import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { bootstrapAcademicDemo } from "./academicDemo";
import type { Role } from "../../src/features/pilot/types";
import { academicId } from './academicFixtures';
const roles: Role[] = ["area_tecnica", "revisor_tecnico", "cam", "gestor_unidade", "gestor_distrital", "administrador", "lideranca"];
const credentials = Object.fromEntries(roles.map(role => [role, { email: `${role}@academic.invalid`, password: "synthetic-test-only" }])) as Record<Role, { email: string; password: string }>;
describe("academic bootstrap safety", () => {
  it.each(["https://example.supabase.co", "http://127.0.0.1.evil.invalid", "http://user:pass@127.0.0.1:54321"])("refuses non-loopback or credential URLs before network calls", async url => {
    await expect(bootstrapAcademicDemo(createClient(url, "not-a-secret"), credentials)).rejects.toThrow(/loopback/i);
  });
  it("refuses non-synthetic identities before provisioning", async () => {
    await expect(bootstrapAcademicDemo(createClient("http://127.0.0.1:54321", "not-a-secret"), { ...credentials, cam: { email: "real@example.com", password: "password" } })).rejects.toThrow(/synthetic/i);
  });
  it("refuses duplicate identities before provisioning", async () => {
    await expect(bootstrapAcademicDemo(createClient("http://127.0.0.1:54321", "not-a-secret"), { ...credentials, cam: credentials.area_tecnica })).rejects.toThrow(/distinct/i);
  });
  it('resumes bootstrap without replacing Auth IDs, versions, assignments, revoked links or business rows', async () => {
    // The HTTP boundary is the slow external dependency. Keep the real SDK and
    // bootstrap; emulate only Auth/REST persistence, including conflict policy.
    const users: {id:string;email:string}[]=[];
    const tables=new Map<string,Record<string,unknown>[]>();
    const client=createClient('http://127.0.0.1:54321','synthetic-admin-key',{auth:{persistSession:false,autoRefreshToken:false,storageKey:'academic-bootstrap-test'},global:{fetch:async(input,init)=>{
      const url=new URL(String(input));
      const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
      if(url.pathname==='/auth/v1/admin/users') {
        if(init?.method==='POST') {
          const body=JSON.parse(String(init.body)) as {email:string};
          const user={id:`actor-${users.length+1}`,email:body.email}; users.push(user); return json(user);
        }
        return json({users,aud:'authenticated'});
      }
      const table=url.pathname.split('/').at(-1)!;
      if(table==='regras') return json({id:'c0de0000-0000-4000-8000-000000000004',indicador_id:'c0de0000-0000-4000-8000-000000000002',versao:1,fator:0.8});
      const rows=tables.get(table)??[]; tables.set(table,rows);
      const keys=(url.searchParams.get('on_conflict')??'id').split(',');
      const incoming=JSON.parse(String(init?.body)) as Record<string,unknown>[];
      for(const row of incoming) {
        const previous=rows.find(saved=>keys.every(key=>saved[key]===row[key]));
        if(previous) {
          if(!new Headers(init?.headers).get('prefer')?.includes('resolution=ignore-duplicates')) Object.assign(previous,row);
        } else rows.push({...row});
      }
      return new Response(null,{status:201});
    }}});
    const first=await bootstrapAcademicDemo(client,credentials);
    const position=tables.get('posicoes_esperadas')!.find(p=>p.id===academicId(110))!;
    Object.assign(position,{lock_version:9,informante_id:'reassigned-actor',aplicavel:false});
    const link=tables.get('vinculos')![0]; link.ativo=false; link.lock_version=4;
    const competence=tables.get('competencias')![0]; competence.estado='em_consolidacao'; competence.lock_version=3;
    tables.set('entradas',[{id:'existing-business',lock_version:7}]);
    const second=await bootstrapAcademicDemo(client,credentials);
    expect(second).toEqual(first);
    expect(users).toHaveLength(10);
    expect(tables.get('posicoes_esperadas')).toHaveLength(12);
    expect(tables.get('vinculos')).toHaveLength(24);
    expect(position).toMatchObject({lock_version:9,informante_id:'reassigned-actor',aplicavel:false});
    expect(link).toMatchObject({ativo:false,lock_version:4});
    expect(competence).toMatchObject({estado:'em_consolidacao',lock_version:3});
    expect(tables.get('entradas')).toEqual([{id:'existing-business',lock_version:7}]);
  });
});
