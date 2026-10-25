begin;

-- Additive boundary: NULL academic identifiers continue to identify legacy rows.
alter table public.competencias
 add column modelo integer not null default 1 check (modelo in (1,2)),
 add column lock_version integer not null default 1 check (lock_version > 0),
 drop constraint competencias_estado_check,
 add constraint competencias_modelo_estado_check check (
  (modelo=1 and estado in ('aberta','em_revisao','fechada','invalidada')) or
  (modelo=2 and estado in ('aberta','em_consolidacao','fechada'))),
 add constraint competencias_mes_check check (modelo=1 or extract(day from referencia)=1);
alter table public.escopos
 add column tipo text check (tipo in ('unidade','distrito')),
 add column distrito_id uuid references public.escopos(id),
 add column ativo boolean not null default true,
 add column lock_version integer not null default 1 check (lock_version > 0),
 add constraint escopos_territorio_check check (distrito_id is null or (tipo='unidade' and distrito_id<>id));
alter table public.vinculos
 add column indicador_id uuid references public.indicadores(id),
 add column ativo boolean not null default true,
 add column vigencia_inicio date,
 add column vigencia_fim date,
 add column lock_version integer not null default 1 check (lock_version > 0),
 add constraint vinculos_papel_academico_check check (papel in ('area_tecnica','revisor_tecnico','cam','gestor_unidade','gestor_distrital','administrador','lideranca')) not valid,
 add constraint vinculos_vigencia_check check (vigencia_fim is null or (vigencia_inicio is not null and vigencia_fim>=vigencia_inicio)),
 add constraint vinculos_academico_inicio_check check (indicador_id is null or vigencia_inicio is not null);
-- NOT VALID preserves unrecognized historical rows without authorizing them;
-- all new/changed rows must use one of the seven academic roles.
-- Preserve uq_vinculos_actor_papel_escopo: the legacy identity bootstrap uses
-- that exact ON CONFLICT target, and this academic MVP has one indicator.

alter table public.regras add constraint uq_regras_id_indicador unique(id,indicador_id);
create table public.posicoes_esperadas (
 id uuid primary key default gen_random_uuid(),
 competencia_id uuid not null references public.competencias(id),
 indicador_id uuid not null references public.indicadores(id),
 alvo_id uuid not null references public.escopos(id),
 regra_id uuid not null,
 aplicavel boolean not null default true,
 informante_id uuid not null references auth.users(id),
 revisor_id uuid not null references auth.users(id),
 lock_version integer not null default 1 check(lock_version>0),
 constraint posicoes_segregacao_check check(informante_id<>revisor_id),
 constraint fk_posicoes_regra_indicador foreign key(regra_id,indicador_id) references public.regras(id,indicador_id),
 constraint uq_posicoes_contexto unique(competencia_id,indicador_id,alvo_id),
 constraint uq_posicoes_identidade unique(id,competencia_id,indicador_id,alvo_id)
);
alter table public.entradas
 add column posicao_id uuid unique,
 add column revisao_atual_id uuid,
 add column lock_version integer not null default 1 check(lock_version>0),
 alter column valor drop not null,
 drop constraint entradas_estado_check,
 add constraint entradas_modelo_estado_check check (
  (posicao_id is null and revisao_atual_id is null and valor is not null and estado in ('pendente','validada','corrigida','fechada','invalidada')) or
  (posicao_id is not null and valor is null and estado in ('rascunho','enviada','em_revisao','devolvida','validada','invalidada'))),
 add constraint fk_entradas_posicao foreign key(posicao_id,competencia_id,indicador_id,escopo_id)
  references public.posicoes_esperadas(id,competencia_id,indicador_id,alvo_id);

create table public.revisoes_entrada (
 id uuid primary key default gen_random_uuid(),
 entrada_id uuid not null references public.entradas(id),
 numero integer not null check(numero>0),
 autor_id uuid not null references auth.users(id),
 estado_dado text not null check(estado_dado in ('valor','indisponivel')),
 valor numeric(12,4) check(valor>=0),
 origem text not null default '',
 periodo_fonte text not null default '',
 motivo text not null default '',
 enviada_em timestamptz,
 constraint uq_revisoes_numero unique(entrada_id,numero),
 constraint uq_revisoes_identidade unique(id,entrada_id),
 constraint revisoes_valor_check check ((estado_dado='indisponivel' and valor is null) or (estado_dado='valor' and (valor is not null or enviada_em is null))),
 constraint revisoes_envio_check check(enviada_em is null or
  (btrim(origem)<>'' and btrim(periodo_fonte)<>'' and (estado_dado<>'indisponivel' or btrim(motivo)<>'')))
);
alter table public.entradas add constraint fk_entradas_revisao_atual foreign key(revisao_atual_id,id) references public.revisoes_entrada(id,entrada_id);
alter table public.resultados
 alter column valor type numeric(18,10) using valor::numeric(18,10),
 add column revisao_id uuid,
 drop constraint uq_resultados_entrada_regra,
 add constraint fk_resultados_revisao foreign key(revisao_id,entrada_id) references public.revisoes_entrada(id,entrada_id);
create unique index uq_resultados_legado on public.resultados(entrada_id,regra_id) where revisao_id is null;
create unique index uq_resultados_revisao on public.resultados(revisao_id) where revisao_id is not null;

create table public.decisoes_entrada (
 id uuid primary key default gen_random_uuid(),
 revisao_id uuid not null references public.revisoes_entrada(id),
 ator_id uuid not null references auth.users(id),
 tipo text not null check(tipo in ('iniciar_revisao','validar','devolver','autorizar_retificacao','decidir_indisponibilidade')),
 motivo text not null default '', referencia text,
 ocorrido_em timestamptz not null default now()
);
create table public.operacoes_dominio (
 id uuid primary key default gen_random_uuid(),
 ator_id uuid not null references auth.users(id), operation_id uuid not null,
 comando text not null check(btrim(comando)<>''),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 resposta jsonb not null check(jsonb_typeof(resposta)='object'),
 ocorrido_em timestamptz not null default now(),
 constraint uq_operacoes_ator_operation unique(ator_id,operation_id)
);
create table public.ativacoes_regra (
 id uuid primary key default gen_random_uuid(),
 indicador_id uuid not null references public.indicadores(id), regra_id uuid not null,
 primeiro_mes date not null check(extract(day from primeiro_mes)=1),
 referencia_demo text not null check(btrim(referencia_demo)<>''),
 constraint fk_ativacoes_regra_indicador foreign key(regra_id,indicador_id) references public.regras(id,indicador_id),
 constraint uq_ativacoes_mes unique(indicador_id,primeiro_mes)
);
create table public.territorios_competencia (
 competencia_id uuid not null references public.competencias(id),
 unidade_id uuid not null references public.escopos(id), distrito_id uuid not null references public.escopos(id),
 primary key(competencia_id,unidade_id), check(unidade_id<>distrito_id)
);
create table public.fechamentos (
 id uuid primary key default gen_random_uuid(),
 competencia_id uuid not null unique references public.competencias(id),
 referencia_demo text not null check(btrim(referencia_demo)<>''),
 ator_id uuid not null references auth.users(id), fechado_em timestamptz not null default now()
);
create table public.itens_fechamento (
 id uuid primary key default gen_random_uuid(),
 fechamento_id uuid not null references public.fechamentos(id),
 posicao_id uuid not null references public.posicoes_esperadas(id),
 alvo_id uuid not null references public.escopos(id),
 revisao_id uuid references public.revisoes_entrada(id),
 regra_id uuid not null references public.regras(id),
 alvo_codigo text not null default '', alvo_tipo text check(alvo_tipo in ('unidade','distrito')),
 regra_versao integer check(regra_versao>0), revisao_numero integer check(revisao_numero>0),
 estado_dado text not null check(estado_dado in ('valor','indisponivel','nao_aplicavel')),
 valor_entrada numeric(12,4), fator numeric(12,6), valor_resultado numeric(18,10),
 memoria jsonb not null check(jsonb_typeof(memoria)='object'),
 constraint uq_itens_posicao unique(fechamento_id,posicao_id),
 constraint itens_valores_check check (
  (estado_dado='valor' and revisao_id is not null and valor_entrada is not null and valor_entrada>=0 and valor_resultado is not null and valor_resultado>=0) or
  (estado_dado<>'valor' and valor_entrada is null and valor_resultado is null))
);
create table public.publicacoes (
 id uuid primary key default gen_random_uuid(),
 fechamento_id uuid not null unique references public.fechamentos(id),
 referencia_demo text not null check(btrim(referencia_demo)<>''),
 ator_id uuid not null references auth.users(id), publicado_em timestamptz not null default now()
);
create table public.contas_demo (
 ator_id uuid primary key references auth.users(id),
 rotulo text not null check(btrim(rotulo)<>''), ativo boolean not null default true
);
alter table public.eventos_auditoria add column correlacao_id uuid;

-- Data-model invariants, not workflow authorization (implemented by later RPCs).
create function private.guard_academic_model() returns trigger language plpgsql set search_path='' as $$
declare v_modelo integer; v_posicao uuid;
begin
 if tg_table_name='posicoes_esperadas' then
  select modelo into v_modelo from public.competencias where id=new.competencia_id;
  if v_modelo<>2 then raise exception using errcode='23514',message='academic_position_requires_academic_competence'; end if;
 elsif tg_table_name='entradas' then
  select modelo into v_modelo from public.competencias where id=new.competencia_id;
  if (v_modelo=1)<>(new.posicao_id is null) then raise exception using errcode='23514',message='entry_model_mismatch'; end if;
 elsif tg_table_name='revisoes_entrada' then
  select posicao_id into v_posicao from public.entradas where id=new.entrada_id;
  if v_posicao is null then raise exception using errcode='23514',message='revision_requires_academic_entry'; end if;
 elsif tg_table_name='resultados' then
  select posicao_id into v_posicao from public.entradas where id=new.entrada_id;
  if (v_posicao is null)<>(new.revisao_id is null) then raise exception using errcode='23514',message='result_model_mismatch'; end if;
 end if;
 return new;
end;
$$;
create trigger academic_position_guard before insert or update on public.posicoes_esperadas for each row execute function private.guard_academic_model();
create trigger academic_entry_guard before insert or update on public.entradas for each row execute function private.guard_academic_model();
create trigger academic_revision_guard before insert or update on public.revisoes_entrada for each row execute function private.guard_academic_model();
create trigger academic_result_guard before insert on public.resultados for each row execute function private.guard_academic_model();

create function private.reject_immutable_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='55000',message='immutable_record'; end;
$$;
create function private.guard_sent_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if old.enviada_em is not null then raise exception using errcode='55000',message='sent_revision_is_immutable'; end if;
 if tg_op='DELETE' then return old; end if;
 if (new.id,new.entrada_id,new.numero,new.autor_id) is distinct from (old.id,old.entrada_id,old.numero,old.autor_id) then
  raise exception using errcode='55000',message='revision_identity_is_immutable';
 end if;
 return new;
end;
$$;
create function private.guard_used_rule() returns trigger language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.resultados where regra_id=old.id) or exists(select 1 from public.posicoes_esperadas where regra_id=old.id)
  or exists(select 1 from public.ativacoes_regra where regra_id=old.id) then
  raise exception using errcode='55000',message='used_rule_is_immutable';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
create trigger revisoes_immutability before update or delete on public.revisoes_entrada for each row execute function private.guard_sent_revision();
create trigger regras_immutability before update or delete on public.regras for each row execute function private.guard_used_rule();
create trigger resultados_immutability before update or delete on public.resultados for each row execute function private.reject_immutable_change();
create trigger decisoes_immutability before update or delete on public.decisoes_entrada for each row execute function private.reject_immutable_change();
create trigger territorios_immutability before update or delete on public.territorios_competencia for each row execute function private.reject_immutable_change();
create trigger fechamentos_immutability before update or delete on public.fechamentos for each row execute function private.reject_immutable_change();
create trigger itens_immutability before update or delete on public.itens_fechamento for each row execute function private.reject_immutable_change();
create trigger publicacoes_immutability before update or delete on public.publicacoes for each row execute function private.reject_immutable_change();
create trigger operacoes_immutability before update or delete on public.operacoes_dominio for each row execute function private.reject_immutable_change();

alter table public.posicoes_esperadas enable row level security;
alter table public.revisoes_entrada enable row level security;
alter table public.decisoes_entrada enable row level security;
alter table public.operacoes_dominio enable row level security;
alter table public.ativacoes_regra enable row level security;
alter table public.territorios_competencia enable row level security;
alter table public.fechamentos enable row level security;
alter table public.itens_fechamento enable row level security;
alter table public.publicacoes enable row level security;
alter table public.contas_demo enable row level security;
revoke all on public.posicoes_esperadas,public.revisoes_entrada,public.decisoes_entrada,public.operacoes_dominio,
 public.ativacoes_regra,public.territorios_competencia,public.fechamentos,public.itens_fechamento,public.publicacoes,public.contas_demo from public,anon,authenticated;
revoke all on function private.guard_academic_model(),private.reject_immutable_change(),private.guard_sent_revision(),private.guard_used_rule() from public,anon,authenticated,service_role;

-- Existing policies may only see legacy rows. T03 owns academic access.
create or replace function private.has_pilot_link(p_papel text,p_escopo_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.vinculos v where v.actor_id=auth.uid()
  and v.indicador_id is null and v.ativo and v.papel in ('area_tecnica','cam')
  and (v.vigencia_inicio is null or v.vigencia_inicio<=current_date) and (v.vigencia_fim is null or v.vigencia_fim>=current_date)
  and (p_papel is null or v.papel=p_papel) and (p_escopo_id is null or v.escopo_id=p_escopo_id));
$$;
alter policy competencias_read_for_pilot_roles on public.competencias using(modelo=1 and private.has_pilot_link(null::text,null::uuid));
alter policy vinculos_read_own_allowed_roles on public.vinculos using(indicador_id is null and actor_id=auth.uid() and papel in ('area_tecnica','cam'));
alter policy entradas_read_for_assigned_scope on public.entradas using(posicao_id is null and (private.has_pilot_link('area_tecnica',escopo_id) or private.has_pilot_link('cam',escopo_id)));
alter policy resultados_read_for_assigned_scope on public.resultados using(revisao_id is null and exists(select 1 from public.entradas e where e.id=resultados.entrada_id and e.posicao_id is null and (private.has_pilot_link('area_tecnica',e.escopo_id) or private.has_pilot_link('cam',e.escopo_id))));
alter policy eventos_auditoria_read_for_assigned_scope on public.eventos_auditoria using(recurso_tipo='entrada' and exists(select 1 from public.entradas e where e.id=eventos_auditoria.recurso_id and e.posicao_id is null and (private.has_pilot_link('area_tecnica',e.escopo_id) or private.has_pilot_link('cam',e.escopo_id))));

-- Preserve the proven legacy implementation behind a guarded private boundary.
alter function private.submit_demo_entry(uuid,uuid,uuid,text,uuid) rename to submit_legacy_entry_internal;
revoke all on function private.submit_legacy_entry_internal(uuid,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function private.submit_demo_entry(p_competencia_id uuid,p_indicador_id uuid,p_escopo_id uuid,p_valor_texto text,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_pilot_link('area_tecnica',p_escopo_id) then
  raise exception using errcode='42501',message='submit_demo_entry_scope_denied';
 end if;
 if exists(select 1 from public.competencias where id=p_competencia_id and modelo<>1)
  or exists(select 1 from public.entradas where autor_id=auth.uid() and operation_id=p_operation_id and posicao_id is not null) then
  raise exception using errcode='22023',message='unsupported_demo_context';
 end if;
 return private.submit_legacy_entry_internal(p_competencia_id,p_indicador_id,p_escopo_id,p_valor_texto,p_operation_id);
end;
$$;
revoke all on function private.submit_demo_entry(uuid,uuid,uuid,text,uuid) from public,anon,service_role;
grant execute on function private.submit_demo_entry(uuid,uuid,uuid,text,uuid) to authenticated;

commit;
