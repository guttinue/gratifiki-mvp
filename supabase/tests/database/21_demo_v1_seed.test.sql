begin;
select no_plan();
\ir ../support/academic-fixture.psql
-- Reads the DEMO-v1 catalogue (migration) and the V3 demonstration data that
-- the academic fixture bootstrap builds through the real commands.
create function pg_temp.month(code text) returns uuid language sql as $$select id from public.competencias where codigo=code$$;
create function pg_temp.scope(code text) returns uuid language sql as $$select id from public.escopos where codigo=code$$;
create function pg_temp.score(month text,unit text) returns jsonb language sql as $$select private.pontuacao_unidade(pg_temp.month(month),pg_temp.scope(unit))$$;

-- Catalogue: DEMO v1, weights 30/25/25/20, legacy DEMO-01 untouched.
select is((select jsonb_build_object('mode',modo_ausencia,'synthetic',sintetico,'reference',referencia,'start',vigencia_inicio) from public.conjuntos_regra where codigo='DEMO' and versao=1),
 jsonb_build_object('mode','zero','synthetic',true,'reference','DEMO-v1 · regra fictícia acadêmica','start','2026-09-01'),'DEMO v1 is synthetic, zero mode, from September 2026');
select is((select string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s',i.codigo,r.nome,trim_scale(r.meta),r.direcao,r.casas_decimais,trim_scale(r.valor_maximo),coalesce(r.unidade_medida,'-'),trim_scale(it.peso)),' ; ' order by i.codigo)
  from public.itens_conjunto it join public.conjuntos_regra s on s.id=it.conjunto_id join public.indicadores i on i.id=it.indicador_id join public.regras r on r.id=it.regra_id where s.codigo='DEMO' and s.versao=1),
 'DEMO-V1-01|Registros conferidos|95|maior_melhor|2|100|%|30 ; DEMO-V1-02|Rotinas concluídas|20|maior_melhor|0|999999|-|25 ; DEMO-V1-03|Tempo de resposta|48|menor_melhor|2|8760|h|25 ; DEMO-V1-04|Verificações realizadas|12|maior_melhor|0|999999|-|20',
 'the four DEMO-v1 meta/weight rules carry the V3 names, targets, directions, places, maxima, units and weights');
select is((select codigo from public.indicadores where id='c0de0000-0000-4000-8000-000000000002'),'DEMO-01','the legacy model-2 indicator keeps its code');
select is((select trim_scale(fator)::text from public.regras where id='c0de0000-0000-4000-8000-000000000004' and indicador_id='c0de0000-0000-4000-8000-000000000002'),'0.8','the legacy factor rule stays on the legacy indicator');

-- A legacy pilot link (no indicator) never reaches a meta/weight rule.
insert into auth.users(id,email,aud,role) values(pg_temp.fixture('pilot'),'t21-pilot@example.invalid','authenticated','authenticated');
insert into public.vinculos(actor_id,papel,escopo_id) values(pg_temp.fixture('pilot'),'area_tecnica',pg_temp.scope('DEMO-ESCOPO-01'));
select pg_temp.login_as('pilot');
set local role authenticated;
select is((select jsonb_agg(c->>'indicadorId') from jsonb_array_elements(public.get_authorized_contexts()->'contexts')c where c->>'competenciaCodigo'='DEMO-2026-09'),
 '["c0de0000-0000-4000-8000-000000000002"]'::jsonb,'a model-1 pilot context still resolves only the legacy factor indicator');
select is((select string_agg(id::text,',') from public.regras),'c0de0000-0000-4000-8000-000000000004','the pilot reads only the legacy factor rule directly');
reset role;

-- Administrator contexts stay inside the model of their indicator.
create function pg_temp.login_account(label text) returns void language plpgsql as $$
declare actor uuid:=(select ator_id from public.contas_demo where rotulo=label);
begin
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
end;$$;
select pg_temp.login_account('Conta acadêmica administrador');
set local role authenticated;
select is((select string_agg(distinct c->>'indicadorId',',' order by c->>'indicadorId') from jsonb_array_elements(public.get_authorized_contexts()->'contexts')c
  where c->>'role'='administrador' and c->>'competenciaCodigo'='ACADEMIC-2026-10'),
 'c0de0000-0000-4000-8000-000000000002','model-2 administrator contexts keep only the legacy indicator');
select is((select string_agg(distinct c->>'indicadorId',',' order by c->>'indicadorId') from jsonb_array_elements(public.get_authorized_contexts()->'contexts')c
  where c->>'role'='administrador' and c->>'competenciaCodigo'='ACADEMIC-V3-2026-10'),
 'c0de0000-0000-4000-8000-000000000101,c0de0000-0000-4000-8000-000000000102,c0de0000-0000-4000-8000-000000000103,c0de0000-0000-4000-8000-000000000104','model-3 administrator contexts use the DEMO-v1 indicators');
reset role;

-- V3 months and positions.
select is((select string_agg(codigo||':'||modelo||':'||estado,',' order by codigo) from public.competencias where conjunto_id='c0de0000-0000-4000-8000-000000000100'),
 'ACADEMIC-V3-2026-09:3:fechada,ACADEMIC-V3-2026-10:3:aberta','September V3 is closed and October V3 is open, both model 3 on DEMO v1');
select is((select count(*)::integer from public.posicoes_esperadas where competencia_id in (pg_temp.month('ACADEMIC-V3-2026-09'),pg_temp.month('ACADEMIC-V3-2026-10'))),32,'16 positions per V3 month');

-- September: closed and published through the real commands.
select is((select f.referencia_demo||'/'||p.referencia_demo from public.fechamentos f join public.publicacoes p on p.fechamento_id=f.id where f.competencia_id=pg_temp.month('ACADEMIC-V3-2026-09')),
 'DEMO-DECISAO-V3-SET/DEMO-PUBLICACAO-V3-SET','September V3 closure and publication carry the DEMO-V3-SET references');
select is(pg_temp.score('ACADEMIC-V3-2026-09','ACADEMIC-NORTE-1')->>'points','88.62','Alfa September scores 88.62');
select is((select jsonb_object_agg(alvo_codigo,trim_scale(pontos)::text) from public.pontuacoes_fechamento s join public.fechamentos f on f.id=s.fechamento_id where f.competencia_id=pg_temp.month('ACADEMIC-V3-2026-09')),
 '{"ACADEMIC-NORTE-1":"88.62","ACADEMIC-NORTE-2":"100","ACADEMIC-SUL-1":"97.17","ACADEMIC-SUL-2":"87.84"}'::jsonb,'September V3 unit scores are frozen (Alfa 88.62, Delta 87.84)');
select is((select trim_scale(i.pontos)::text from public.itens_fechamento i join public.posicoes_esperadas p on p.id=i.posicao_id
  where p.competencia_id=pg_temp.month('ACADEMIC-V3-2026-09') and p.alvo_id=pg_temp.scope('ACADEMIC-NORTE-1') and p.indicador_id='c0de0000-0000-4000-8000-000000000101'),'27.79','Alfa September DEMO-V1-01 is frozen at 27.79');

-- October: the V3 initial state.
select is((select string_agg(s.codigo||'/'||i.codigo||'='||coalesce(e.estado,'ausente'),' ' order by s.codigo,i.codigo) from public.posicoes_esperadas p
  join public.escopos s on s.id=p.alvo_id join public.indicadores i on i.id=p.indicador_id left join public.entradas e on e.posicao_id=p.id
  where p.competencia_id=pg_temp.month('ACADEMIC-V3-2026-10')),
 'ACADEMIC-NORTE-1/DEMO-V1-01=rascunho ACADEMIC-NORTE-1/DEMO-V1-02=enviada ACADEMIC-NORTE-1/DEMO-V1-03=devolvida ACADEMIC-NORTE-1/DEMO-V1-04=validada '||
 'ACADEMIC-NORTE-2/DEMO-V1-01=em_revisao ACADEMIC-NORTE-2/DEMO-V1-02=ausente ACADEMIC-NORTE-2/DEMO-V1-03=validada ACADEMIC-NORTE-2/DEMO-V1-04=validada '||
 'ACADEMIC-SUL-1/DEMO-V1-01=validada ACADEMIC-SUL-1/DEMO-V1-02=validada ACADEMIC-SUL-1/DEMO-V1-03=validada ACADEMIC-SUL-1/DEMO-V1-04=validada '||
 'ACADEMIC-SUL-2/DEMO-V1-01=validada ACADEMIC-SUL-2/DEMO-V1-02=validada ACADEMIC-SUL-2/DEMO-V1-03=validada ACADEMIC-SUL-2/DEMO-V1-04=validada',
 'October V3 positions are in the V3 initial states');
select is((select string_agg(trim_scale(v.valor)::text,',' order by i.codigo) from public.posicoes_esperadas p join public.indicadores i on i.id=p.indicador_id
  join public.entradas e on e.posicao_id=p.id join public.revisoes_entrada v on v.id=e.revisao_atual_id
  where p.competencia_id=pg_temp.month('ACADEMIC-V3-2026-10') and p.alvo_id=pg_temp.scope('ACADEMIC-NORTE-1')),'90,16,96,12','Alfa October holds 90, 16, 96 and 12');
select is((select d.motivo from public.decisoes_entrada d join public.entradas e on e.revisao_atual_id=d.revisao_id join public.posicoes_esperadas p on p.id=e.posicao_id
  where p.competencia_id=pg_temp.month('ACADEMIC-V3-2026-10') and p.alvo_id=pg_temp.scope('ACADEMIC-NORTE-1') and p.indicador_id='c0de0000-0000-4000-8000-000000000103' and d.tipo='devolver'),
 'A fonte informada é de setembro. Confirme o tempo de resposta de outubro e reenvie.','Alfa DEMO-V1-03 is returned with the V3 reason');
select is((select v.estado_dado||'|'||d.referencia from public.decisoes_entrada d join public.entradas e on e.revisao_atual_id=d.revisao_id join public.revisoes_entrada v on v.id=d.revisao_id
  join public.posicoes_esperadas p on p.id=e.posicao_id
  where p.competencia_id=pg_temp.month('ACADEMIC-V3-2026-10') and p.alvo_id=pg_temp.scope('ACADEMIC-SUL-2') and p.indicador_id='c0de0000-0000-4000-8000-000000000103' and d.tipo='decidir_indisponibilidade'),
 'indisponivel|DEMO-V3-INDISP','Delta DEMO-V1-03 unavailability is accepted and decided by the CAM');
select is(pg_temp.score('ACADEMIC-V3-2026-10','ACADEMIC-SUL-2')-'items',jsonb_build_object('points','69.87','complete',true,'noBase',false,'mode','zero'),'Delta October is complete with 69.87 in zero mode');
select is(pg_temp.score('ACADEMIC-V3-2026-10','ACADEMIC-NORTE-1')->'complete','false','Alfa October is still partial');

-- Links: leadership in both districts; CAM on the 4 indicators of the 4 units.
select is((select string_agg(distinct s.codigo,',' order by s.codigo) from public.vinculos v join public.escopos s on s.id=v.escopo_id
  where v.papel='lideranca' and v.indicador_id='c0de0000-0000-4000-8000-000000000101'),'ACADEMIC-NORTE,ACADEMIC-SUL','leadership holds DEMO-v1 links in Norte and Sul');
select is((select count(*)::integer from public.vinculos v join public.contas_demo a on a.ator_id=v.actor_id
  where v.papel='cam' and v.indicador_id in (select indicador_id from public.itens_conjunto where conjunto_id='c0de0000-0000-4000-8000-000000000100') and a.rotulo='Conta acadêmica cam'),16,'the CAM holds the 16 DEMO-v1 unit links');

select * from finish();rollback;
