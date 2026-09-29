create table public.competencias (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (btrim(codigo) <> ''),
  referencia date not null,
  estado text not null check (estado in ('aberta', 'em_revisao', 'fechada', 'invalidada'))
);

comment on column public.competencias.referencia is
  'Fixed date for synthetic rule-version selection; it is not an institutional calendar date.';

create table public.indicadores (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (btrim(codigo) <> '')
);

create table public.escopos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (btrim(codigo) <> '')
);

create table public.vinculos (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  papel text not null check (btrim(papel) <> ''),
  escopo_id uuid not null,
  constraint fk_vinculos_actor foreign key (actor_id) references auth.users (id),
  constraint fk_vinculos_escopo foreign key (escopo_id) references public.escopos (id),
  constraint uq_vinculos_actor_papel_escopo unique (actor_id, papel, escopo_id)
);

create table public.regras (
  id uuid primary key default gen_random_uuid(),
  indicador_id uuid not null,
  versao integer not null check (versao > 0),
  fator numeric(12, 6) not null check (fator > 0),
  vigencia_inicio date not null,
  vigencia_fim date,
  constraint fk_regras_indicador foreign key (indicador_id) references public.indicadores (id),
  constraint uq_regras_indicador_versao unique (indicador_id, versao),
  constraint ck_regras_vigencia check (vigencia_fim is null or vigencia_fim >= vigencia_inicio)
);

create table public.entradas (
  id uuid primary key default gen_random_uuid(),
  competencia_id uuid not null,
  indicador_id uuid not null,
  escopo_id uuid not null,
  autor_id uuid not null,
  valor numeric(12, 4) not null check (valor >= 0),
  estado text not null check (estado in ('pendente', 'validada', 'corrigida', 'fechada', 'invalidada')),
  revisao integer not null check (revisao > 0),
  operation_id uuid not null,
  constraint fk_entradas_competencia foreign key (competencia_id) references public.competencias (id),
  constraint fk_entradas_indicador foreign key (indicador_id) references public.indicadores (id),
  constraint fk_entradas_escopo foreign key (escopo_id) references public.escopos (id),
  constraint fk_entradas_autor foreign key (autor_id) references auth.users (id),
  constraint uq_entradas_autor_operation unique (autor_id, operation_id)
);

create table public.resultados (
  id uuid primary key default gen_random_uuid(),
  entrada_id uuid not null,
  regra_id uuid not null,
  valor numeric(12, 4) not null check (valor >= 0),
  memoria jsonb not null check (jsonb_typeof(memoria) = 'object'),
  constraint fk_resultados_entrada foreign key (entrada_id) references public.entradas (id),
  constraint fk_resultados_regra foreign key (regra_id) references public.regras (id),
  constraint uq_resultados_entrada_regra unique (entrada_id, regra_id)
);

create table public.eventos_auditoria (
  id uuid primary key default gen_random_uuid(),
  recurso_tipo text not null check (btrim(recurso_tipo) <> ''),
  recurso_id uuid not null,
  actor_id uuid not null,
  acao text not null check (btrim(acao) <> ''),
  ocorrido_em timestamptz not null default now(),
  detalhes jsonb not null default '{}'::jsonb check (jsonb_typeof(detalhes) = 'object'),
  constraint fk_eventos_auditoria_actor foreign key (actor_id) references auth.users (id)
);

alter table public.competencias enable row level security;
alter table public.indicadores enable row level security;
alter table public.escopos enable row level security;
alter table public.vinculos enable row level security;
alter table public.regras enable row level security;
alter table public.entradas enable row level security;
alter table public.resultados enable row level security;
alter table public.eventos_auditoria enable row level security;

revoke all on table public.competencias, public.indicadores, public.escopos, public.vinculos,
  public.regras, public.entradas, public.resultados, public.eventos_auditoria
  from anon, authenticated;

grant all on table public.competencias, public.indicadores, public.escopos, public.vinculos,
  public.regras, public.entradas, public.resultados, public.eventos_auditoria
  to service_role;
