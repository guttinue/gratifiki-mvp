begin;

-- Model 3 (meta/weight rule sets). Model 2 keeps its factor rules unchanged.
alter table public.regras
 add column metodo text not null default 'fator' check (metodo in ('fator','meta_peso')),
 add column meta numeric(14,4),
 add column direcao text check (direcao in ('maior_melhor','menor_melhor')),
 add column casas_decimais smallint check (casas_decimais between 0 and 4),
 add column valor_maximo numeric(14,4),
 add column unidade_medida text,
 add column nome text,
 alter column fator drop not null,
 drop constraint regras_fator_check,
 add constraint ck_regras_metodo check (
  (metodo='fator' and fator>0 and meta is null and direcao is null) or
  (metodo='meta_peso' and fator is null and meta>0 and direcao is not null and casas_decimais is not null and valor_maximo>=meta));

create table public.conjuntos_regra (
 id uuid primary key default gen_random_uuid(),
 codigo text not null,
 versao integer not null check (versao>0),
 modo_ausencia text not null check (modo_ausencia in ('zero','redistribuir')),
 sintetico boolean not null,
 vigencia_inicio date not null,
 referencia text not null check (btrim(referencia)<>''),
 constraint uq_conjuntos_regra_codigo_versao unique (codigo,versao)
);
-- metadados keeps room for future official per-item overrides; nothing reads it yet.
create table public.itens_conjunto (
 conjunto_id uuid not null references public.conjuntos_regra(id),
 indicador_id uuid not null references public.indicadores(id),
 regra_id uuid not null,
 peso numeric(7,4) not null check (peso>0),
 metadados jsonb not null default '{}' check (jsonb_typeof(metadados)='object'),
 primary key (conjunto_id,indicador_id),
 constraint fk_itens_conjunto_regra_indicador foreign key (regra_id,indicador_id) references public.regras(id,indicador_id)
);

alter table public.competencias
 drop constraint competencias_modelo_check,
 drop constraint competencias_modelo_estado_check,
 add column conjunto_id uuid references public.conjuntos_regra(id);
alter table public.competencias
 add constraint competencias_modelo_check check (modelo in (1,2,3)),
 add constraint competencias_modelo_estado_check check (
  (modelo=1 and estado in ('aberta','em_revisao','fechada','invalidada')) or
  (modelo in (2,3) and estado in ('aberta','em_consolidacao','fechada'))),
 add constraint competencias_conjunto_check check ((modelo=3)=(conjunto_id is not null));

-- One person may hold one link per indicator in the same role and scope.
-- NULL indicators (legacy pilot links) stay unique, as before.
alter table public.vinculos
 drop constraint uq_vinculos_actor_papel_escopo,
 add constraint uq_vinculos_actor_papel_escopo_indicador unique nulls not distinct (actor_id,papel,escopo_id,indicador_id);

-- "Não se aplica" follows the unavailable rules: no value, reason required.
alter table public.revisoes_entrada
 drop constraint revisoes_entrada_estado_dado_check,
 drop constraint revisoes_valor_check,
 drop constraint revisoes_envio_check;
alter table public.revisoes_entrada
 add constraint revisoes_entrada_estado_dado_check check (estado_dado in ('valor','indisponivel','nao_aplicavel')),
 add constraint revisoes_valor_check check ((estado_dado in ('indisponivel','nao_aplicavel') and valor is null) or (estado_dado='valor' and (valor is not null or enviada_em is null))),
 add constraint revisoes_envio_check check (enviada_em is null or
  (btrim(origem)<>'' and btrim(periodo_fonte)<>'' and (estado_dado='valor' or btrim(motivo)<>'')));

-- Frozen model-3 calculation inputs; all NULL for model-2 items.
alter table public.itens_fechamento
 add column metodo text,
 add column meta numeric(14,4),
 add column direcao text,
 add column peso numeric(7,4),
 add column peso_efetivo numeric(18,10),
 add column razao numeric(18,10),
 add column pontos numeric(7,2),
 add column conjunto_id uuid,
 add column conjunto_versao integer,
 add column modo_ausencia text;

create table public.pontuacoes_fechamento (
 fechamento_id uuid not null references public.fechamentos(id),
 alvo_id uuid not null references public.escopos(id),
 alvo_codigo text not null,
 distrito_id uuid,
 pontos numeric(7,2),
 completo boolean not null,
 sem_base boolean not null,
 conjunto_id uuid not null,
 conjunto_versao integer not null,
 primary key (fechamento_id,alvo_id)
);

-- Checked at commit so a set and its items can be inserted in separate
-- statements: weights total exactly 100 and every item rule is meta/weight.
create function private.guard_rule_set_total() returns trigger language plpgsql set search_path='' as $$
declare v_ids uuid[];
begin
 if tg_table_name='conjuntos_regra' then v_ids:=array[new.id];
 elsif tg_op='INSERT' then v_ids:=array[new.conjunto_id];
 elsif tg_op='DELETE' then v_ids:=array[old.conjunto_id];
 else v_ids:=array[old.conjunto_id,new.conjunto_id];
 end if;
 if exists(select 1 from public.conjuntos_regra c where c.id=any(v_ids) and (
   coalesce((select sum(i.peso) from public.itens_conjunto i where i.conjunto_id=c.id),0)<>100
   or exists(select 1 from public.itens_conjunto i join public.regras r on r.id=i.regra_id where i.conjunto_id=c.id and r.metodo<>'meta_peso'))) then
  raise exception using errcode='22023',message='invalid_input';
 end if;
 return null;
end;$$;
-- Same rule as private.reject_immutable_change, but only once a competence
-- references the set (a WHEN helper would need EXECUTE for every writer).
create function private.guard_used_rule_set() returns trigger language plpgsql set search_path='' as $$
declare v_ids uuid[];
begin
 if tg_table_name='conjuntos_regra' then v_ids:=array[old.id];
 elsif tg_op='INSERT' then v_ids:=array[new.conjunto_id];
 elsif tg_op='DELETE' then v_ids:=array[old.conjunto_id];
 else v_ids:=array[old.conjunto_id,new.conjunto_id];
 end if;
 if exists(select 1 from public.competencias where conjunto_id=any(v_ids)) then
  raise exception using errcode='55000',message='immutable_record';
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;$$;
create constraint trigger conjuntos_regra_total after insert on public.conjuntos_regra
 deferrable initially deferred for each row execute function private.guard_rule_set_total();
create constraint trigger itens_conjunto_total after insert or update or delete on public.itens_conjunto
 deferrable initially deferred for each row execute function private.guard_rule_set_total();
create trigger conjuntos_regra_immutability before update or delete on public.conjuntos_regra for each row execute function private.guard_used_rule_set();
create trigger itens_conjunto_immutability before insert or update or delete on public.itens_conjunto for each row execute function private.guard_used_rule_set();
create trigger pontuacoes_immutability before update or delete on public.pontuacoes_fechamento for each row execute function private.reject_immutable_change();

alter table public.conjuntos_regra enable row level security;
alter table public.itens_conjunto enable row level security;
alter table public.pontuacoes_fechamento enable row level security;
revoke all on public.conjuntos_regra,public.itens_conjunto,public.pontuacoes_fechamento from public,anon,authenticated;
revoke all on function private.guard_rule_set_total(),private.guard_used_rule_set() from public,anon,authenticated,service_role;

-- Link administration resolves the link of the requested indicator (new key).
create or replace function private.administer_academic_metadata(p_contexto jsonb,p_command text,p_payload jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb;inp jsonb;canonical jsonb;old_op public.operacoes_dominio%rowtype;response jsonb;
 s public.escopos%rowtype;link public.vinculos%rowtype;sid uuid;district uuid;actor uuid;indicator uuid;
 code text;kind text;role_name text;active boolean;start_date date;end_date date;expected integer;new_version integer;resource uuid;event_name text;resource_type text;
begin
 ctx:=private.require_academic_context(p_contexto,'admin_write');
 if p_command not in ('save_demo_scope','set_demo_business_link') then raise exception using errcode='42501',message='access_denied';end if;
 if p_operation_id is null or jsonb_typeof(p_payload) is distinct from 'object' or jsonb_typeof(p_payload->'input') is distinct from 'object'
  or jsonb_typeof(p_payload->'expectedVersion') is distinct from 'number' or (p_payload->>'expectedVersion')!~'^[0-9]+$'
  or (p_payload->>'expectedVersion')::numeric>2147483647 then raise exception using errcode='22023',message='invalid_input';end if;
 expected:=(p_payload->>'expectedVersion')::integer;inp:=p_payload->'input';
 if p_command='save_demo_scope' then
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['scopeId','expectedVersion','input'])
   or (select count(*) from jsonb_object_keys(inp))<>4 or not(inp?&array['codigo','tipo','distritoId','ativo'])
   or jsonb_typeof(inp->'codigo') is distinct from 'string' or jsonb_typeof(inp->'tipo') is distinct from 'string'
   or jsonb_typeof(inp->'ativo') is distinct from 'boolean' or jsonb_typeof(inp->'distritoId') not in ('string','null')
   or jsonb_typeof(p_payload->'scopeId') not in ('string','null') then raise exception using errcode='22023',message='invalid_input';end if;
  begin sid:=(p_payload->>'scopeId')::uuid;district:=(inp->>'distritoId')::uuid;exception when invalid_text_representation then raise exception using errcode='22023',message='invalid_input';end;
  code:=private.trim_academic_text(inp->>'codigo');kind:=inp->>'tipo';active:=(inp->>'ativo')::boolean;
  if length(code) not between 1 and 100 or kind not in ('unidade','distrito') or (kind='distrito' and district is not null) or (kind='unidade' and district is null) or (sid is not null and sid=district) then raise exception using errcode='22023',message='invalid_input';end if;
  inp:=jsonb_build_object('codigo',code,'tipo',kind,'distritoId',district,'ativo',active);
  canonical:=jsonb_build_object('context',p_contexto,'scopeId',sid,'expectedVersion',expected,'input',inp);
 else
  if (select count(*) from jsonb_object_keys(p_payload))<>3 or not(p_payload?&array['actorId','expectedVersion','input'])
   or (select count(*) from jsonb_object_keys(inp))<>6 or not(inp?&array['role','escopoId','indicadorId','ativo','vigenciaInicio','vigenciaFim']) then raise exception using errcode='22023',message='invalid_input';end if;
  if jsonb_typeof(p_payload->'actorId') is distinct from 'string' or jsonb_typeof(inp->'role') is distinct from 'string'
   or jsonb_typeof(inp->'escopoId') is distinct from 'string' or jsonb_typeof(inp->'indicadorId') is distinct from 'string'
   or jsonb_typeof(inp->'ativo') is distinct from 'boolean' or jsonb_typeof(inp->'vigenciaInicio') is distinct from 'string' or jsonb_typeof(inp->'vigenciaFim') not in ('string','null') then raise exception using errcode='22023',message='invalid_input';end if;
  begin actor:=(p_payload->>'actorId')::uuid;sid:=(inp->>'escopoId')::uuid;indicator:=(inp->>'indicadorId')::uuid;
   if (inp->>'vigenciaInicio')!~'^\d{4}-\d{2}-\d{2}$' or (inp->>'vigenciaFim' is not null and (inp->>'vigenciaFim')!~'^\d{4}-\d{2}-\d{2}$') then raise exception using errcode='22023',message='invalid_input';end if;
   start_date:=(inp->>'vigenciaInicio')::date;end_date:=(inp->>'vigenciaFim')::date;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='invalid_input';end;
  role_name:=inp->>'role';active:=(inp->>'ativo')::boolean;
  if actor=auth.uid() or role_name='administrador' or not exists(select 1 from public.contas_demo where ator_id=actor and ativo) then raise exception using errcode='42501',message='access_denied';end if;
  if role_name not in ('area_tecnica','revisor_tecnico','cam','gestor_unidade','gestor_distrital','lideranca') or indicator<>(ctx->>'indicadorId')::uuid or start_date is null or (end_date is not null and end_date<start_date) then raise exception using errcode='22023',message='invalid_input';end if;
  inp:=jsonb_build_object('role',role_name,'escopoId',sid,'indicadorId',indicator,'ativo',active,'vigenciaInicio',start_date::text,'vigenciaFim',end_date::text);
  canonical:=jsonb_build_object('context',p_contexto,'actorId',actor,'expectedVersion',expected,'input',inp);
 end if;
 -- All metadata commands serialize across months. Competence first matches the
 -- domain lock order; the fixed catalogue lock also covers absent natural keys.
 perform id from public.competencias where id=(ctx->>'competenciaId')::uuid for update;
 perform pg_advisory_xact_lock(hashtextextended('academic:admin-catalog',0));
 select * into s from public.escopos where id=sid for update;
 if p_command='set_demo_business_link' then
  perform ator_id from public.contas_demo where ator_id=actor for share;
  -- One link per indicator: the requested one wins; a legacy NULL-indicator
  -- link still collides (invalid_input below) instead of gaining authority.
  select * into link from public.vinculos where actor_id=actor and papel=role_name and escopo_id=sid
   and (indicador_id=indicator or indicador_id is null) order by indicador_id nulls last limit 1 for update;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_operation_id::text,0));
 ctx:=private.require_academic_context(p_contexto,'admin_write');
 if p_command='set_demo_business_link' and (actor=auth.uid() or role_name='administrador' or not exists(select 1 from public.contas_demo where ator_id=actor and ativo)) then raise exception using errcode='42501',message='access_denied';end if;
 select * into old_op from public.operacoes_dominio where ator_id=auth.uid() and operation_id=p_operation_id;
 if old_op.id is not null then
  if old_op.comando<>p_command or old_op.payload<>canonical then raise exception using errcode='22023',message='operation_payload_mismatch';end if;
  return old_op.resposta;
 end if;
 if p_command='save_demo_scope' then
  if sid is not null and (s.id is null or s.tipo is null) then raise exception using errcode='22023',message='invalid_input';end if;
  if expected<>(case when sid is null then 0 else s.lock_version end) then raise exception using errcode='40001',message='version_conflict';end if;
  if exists(select 1 from public.escopos where codigo=code and (sid is null or id<>sid)) then raise exception using errcode='22023',message='invalid_input';end if;
  if district is not null and not exists(select 1 from public.escopos where id=district and tipo='distrito' and (ativo or (s.id is not null and s.distrito_id=district))) then raise exception using errcode='22023',message='invalid_input';end if;
  -- Current territorial membership may change; past identity/type may not.
  if s.id is not null and s.tipo<>kind and (exists(select 1 from public.posicoes_esperadas where alvo_id=s.id) or exists(select 1 from public.vinculos where escopo_id=s.id) or exists(select 1 from public.territorios_competencia where unidade_id=s.id or distrito_id=s.id) or exists(select 1 from public.entradas where escopo_id=s.id) or exists(select 1 from public.escopos where distrito_id=s.id)) then raise exception using errcode='22023',message='invalid_input';end if;
  if sid is null then
   insert into public.escopos(codigo,tipo,distrito_id,ativo) values(code,kind,district,active) returning id,lock_version into resource,new_version;
  else
   update public.escopos set codigo=code,tipo=kind,distrito_id=district,ativo=active,lock_version=lock_version+1 where id=sid returning id,lock_version into resource,new_version;
  end if;
  event_name:='escopo_demo_salvo';resource_type:='escopo';
 else
  if s.id is null or s.tipo is null or (role_name='gestor_unidade' and s.tipo<>'unidade') or (role_name in ('gestor_distrital','lideranca') and s.tipo<>'distrito') or (link.id is not null and link.indicador_id is distinct from indicator) then raise exception using errcode='22023',message='invalid_input';end if;
  if expected<>coalesce(link.lock_version,0) then raise exception using errcode='40001',message='version_conflict';end if;
  -- Inactive catalogues preserve only the existing authorization interval.
  -- A NULL end is unbounded; restoring an expired/future active link through
  -- date expansion is a new use just like toggling ativo back to true.
  -- Revocation has an empty effective interval and remains permitted.
  if not s.ativo and (link.id is null or (active and (not link.ativo
   or link.vigencia_inicio is null or start_date<link.vigencia_inicio
   or (link.vigencia_fim is not null and (end_date is null or end_date>link.vigencia_fim))))) then raise exception using errcode='22023',message='invalid_input';end if;
  if link.id is null then
   insert into public.vinculos(actor_id,papel,escopo_id,indicador_id,ativo,vigencia_inicio,vigencia_fim) values(actor,role_name,sid,indicator,active,start_date,end_date) returning id,lock_version into resource,new_version;
  else
   update public.vinculos set ativo=active,vigencia_inicio=start_date,vigencia_fim=end_date,lock_version=lock_version+1 where id=link.id returning id,lock_version into resource,new_version;
  end if;
  event_name:='vinculo_demo_alterado';resource_type:='vinculo';
 end if;
 response:=jsonb_build_object('resourceId',resource,'version',new_version,'revisionId',null,'status',case when active then 'ativo' else 'inativo' end,'resultValue',null);
 insert into public.eventos_auditoria(actor_id,acao,recurso_tipo,recurso_id,detalhes,correlacao_id) values(auth.uid(),event_name,resource_type,resource,jsonb_build_object('version',new_version),p_operation_id);
 insert into public.operacoes_dominio(ator_id,operation_id,comando,payload,resposta) values(auth.uid(),p_operation_id,p_command,canonical,response);
 return response;
end;$$;

commit;
