begin;
-- No historical backfill: current catalogues cannot prove past labels. Old
-- snapshots retain NULL metadata and fail closed instead of changing history.
alter table public.fechamentos add column competencia_codigo text;
alter table public.itens_fechamento add column indicador_id uuid references public.indicadores(id),add column indicador_codigo text,add column unidade_medida text;
create function private.capture_export_metadata() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='fechamentos' then
  select codigo into new.competencia_codigo from public.competencias where id=new.competencia_id;
 else
  select i.id,i.codigo into new.indicador_id,new.indicador_codigo from public.regras r join public.indicadores i on i.id=r.indicador_id where r.id=new.regra_id;
  -- The academic model has no institutional measurement catalogue. This fixed
  -- demonstration label is frozen too, not inferred from future metadata.
  new.unidade_medida:='pontos sintéticos';
 end if;
 return new;
end;$$;
create trigger capture_closure_export_metadata before insert on public.fechamentos for each row execute function private.capture_export_metadata();
create trigger capture_item_export_metadata before insert on public.itens_fechamento for each row execute function private.capture_export_metadata();

create function private.export_academic_snapshot(p_contexto jsonb,p_payload jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;c public.competencias%rowtype;f public.fechamentos%rowtype;old_op public.operacoes_dominio%rowtype;
 sid uuid;canonical jsonb;response jsonb;rows jsonb;totals jsonb;versions jsonb;publication_version integer;
 position_count integer;calculable_count integer;unavailable_count integer;na_count integer;
begin
 ctx:=private.require_academic_context(p_contexto,'export');
 -- Possessing one district CAM context never implies coverage of its units.
 if not exists(select 1 from public.posicoes_esperadas where competencia_id=(ctx->>'competenciaId')::uuid) or exists(select 1 from public.posicoes_esperadas p where p.competencia_id=(ctx->>'competenciaId')::uuid and not(ctx->'positionIds'?p.id::text)) then raise exception using errcode='42501',message='access_denied';end if;
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_payload))<>1 or not(p_payload?'snapshotId') or jsonb_typeof(p_payload->'snapshotId') is distinct from 'string' then raise exception using errcode='22023',message='invalid_input';end if;
 begin sid:=(p_payload->>'snapshotId')::uuid;exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_input';end;
 if sid is null then raise exception using errcode='22023',message='invalid_input';end if;
 canonical:=jsonb_build_object('context',p_contexto,'snapshotId',sid);
 -- Same order as cycle writers; authority is re-resolved after every wait.
 select * into c from public.competencias where id=(ctx->>'competenciaId')::uuid for update;
 perform id from public.posicoes_esperadas where competencia_id=c.id order by id for update;
 perform e.id from public.entradas e join public.posicoes_esperadas p on p.id=e.posicao_id where p.competencia_id=c.id order by e.id for update of e;
 perform v.id from public.revisoes_entrada v join public.entradas e on e.id=v.entrada_id where e.competencia_id=c.id and e.posicao_id is not null order by v.id for update of v;
 select * into f from public.fechamentos where competencia_id=c.id for update;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_operation_id::text,0));
 ctx:=private.require_academic_context(p_contexto,'export');
 if not exists(select 1 from public.posicoes_esperadas where competencia_id=c.id) or exists(select 1 from public.posicoes_esperadas p where p.competencia_id=c.id and not(ctx->'positionIds'?p.id::text)) then raise exception using errcode='42501',message='access_denied';end if;
 if c.estado<>'fechada' then raise exception using errcode='55000',message='invalid_state';end if;
 if f.id is null or f.id<>sid then raise exception using errcode='42501',message='access_denied';end if;
 -- Export is entirely snapshot-based, including labels. Missing metadata on
 -- a pre-upgrade snapshot is not repaired or substituted with today's labels.
 if f.competencia_codigo is null or exists(select 1 from public.itens_fechamento where fechamento_id=f.id and (indicador_id is null or indicador_codigo is null or unidade_medida is null)) then raise exception using errcode='55000',message='snapshot_metadata_unavailable';end if;
 if not exists(select 1 from public.itens_fechamento where fechamento_id=f.id) or exists(select 1 from public.itens_fechamento i where i.fechamento_id=f.id and (i.indicador_id<>(ctx->>'indicadorId')::uuid or not(ctx->'positionIds'?i.posicao_id::text))) then raise exception using errcode='42501',message='access_denied';end if;
 select * into old_op from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if old_op.id is not null then
  if old_op.comando<>'get_snapshot_export' or old_op.payload<>canonical then raise exception using errcode='22023',message='operation_payload_mismatch';end if;
  return old_op.resposta;
 end if;
 publication_version:=case when exists(select 1 from public.publicacoes where fechamento_id=f.id) then 1 else 0 end;
 select count(*)::integer,count(*)filter(where estado_dado='valor')::integer,count(*)filter(where estado_dado='indisponivel')::integer,count(*)filter(where estado_dado='nao_aplicavel')::integer,
  jsonb_agg(jsonb_build_object('snapshotId',f.id,'competencia',f.competencia_codigo,'indicador',indicador_codigo,'alvoTipo',alvo_tipo,'alvoCodigo',alvo_codigo,'regraVersao',regra_versao,'revisao',revisao_numero,'estadoDado',estado_dado,'entrada',trim_scale(valor_entrada)::text,'fator',trim_scale(fator)::text,'resultado',trim_scale(valor_resultado)::text,'publicacao',case publication_version when 1 then 'publicada_demo' else 'nao_publicada' end) order by alvo_tipo collate "C",alvo_codigo collate "C",indicador_codigo collate "C")
 into position_count,calculable_count,unavailable_count,na_count,rows from public.itens_fechamento where fechamento_id=f.id;
 select jsonb_agg(versao order by versao) into versions from(select distinct regra_versao versao from public.itens_fechamento where fechamento_id=f.id)v;
 select coalesce(jsonb_agg(jsonb_build_object('tipo',alvo_tipo,'unidadeMedida',unidade_medida,'sum',trim_scale(soma)::text) order by alvo_tipo collate "C",unidade_medida collate "C"),'[]'::jsonb) into totals from(select alvo_tipo,unidade_medida,sum(valor_resultado) soma from public.itens_fechamento where fechamento_id=f.id and estado_dado='valor' group by alvo_tipo,unidade_medida)t;
 response:=jsonb_build_object('contractVersion',1,'snapshotId',f.id,'rows',rows,'manifest',jsonb_build_object('competencia',f.competencia_codigo,'ruleVersions',versions,'publicationVersion',publication_version,'positionCount',position_count,'calculableCount',calculable_count,'unavailableCount',unavailable_count,'notApplicableCount',na_count,'totals',totals));
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id) values(auth.uid(),'snapshot_exportado_demo','competencia',c.id,jsonb_build_object('version',c.lock_version,'snapshotId',f.id,'contractVersion',1,'publicationVersion',publication_version),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,'get_snapshot_export',canonical,response);
 return response;
end;$$;
create or replace function private.run_academic_command(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_command in ('save_draft','submit') then return private.run_academic_submission(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('start_review','review') then return private.review_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('correct','authorize_correction','decide_unavailability') then return private.correct_academic_position(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command in ('transition_cycle','publish_cycle_demo') then return private.transition_academic_cycle(p_contexto,p_command,p_payload,p_operation_id);
 elsif p_command='get_snapshot_export' then return private.export_academic_snapshot(p_contexto,p_payload,p_operation_id);
 else raise exception using errcode='42501',message='access_denied';end if;
end;$$;
create function public.get_snapshot_export(p_contexto jsonb,p_snapshot_id uuid,p_operation_id uuid) returns jsonb
language sql security definer set search_path='' as $$select private.run_academic_command(p_contexto,'get_snapshot_export',jsonb_build_object('snapshotId',p_snapshot_id),p_operation_id);$$;
revoke all on function private.capture_export_metadata(),private.export_academic_snapshot(jsonb,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_snapshot_export(jsonb,uuid,uuid) from public,anon,service_role;
grant execute on function public.get_snapshot_export(jsonb,uuid,uuid) to authenticated;
commit;
