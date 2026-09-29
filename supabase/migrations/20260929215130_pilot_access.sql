begin;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.has_pilot_link(p_papel text, p_escopo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.vinculos as v
      where v.actor_id = auth.uid()
        and v.papel in ('area_tecnica', 'cam')
        and (p_papel is null or v.papel = p_papel)
        and (p_escopo_id is null or v.escopo_id = p_escopo_id)
    );
$$;

revoke all on function private.has_pilot_link(text, uuid) from public, anon;
grant execute on function private.has_pilot_link(text, uuid) to authenticated;

revoke all on table
  public.competencias,
  public.indicadores,
  public.escopos,
  public.vinculos,
  public.regras,
  public.entradas,
  public.resultados,
  public.eventos_auditoria
from anon, authenticated;

grant select on table
  public.competencias,
  public.indicadores,
  public.escopos,
  public.vinculos,
  public.regras,
  public.entradas,
  public.resultados,
  public.eventos_auditoria
to anon, authenticated;

alter table public.competencias enable row level security;
alter table public.indicadores enable row level security;
alter table public.escopos enable row level security;
alter table public.vinculos enable row level security;
alter table public.regras enable row level security;
alter table public.entradas enable row level security;
alter table public.resultados enable row level security;
alter table public.eventos_auditoria enable row level security;

create policy competencias_read_for_pilot_roles
on public.competencias for select to authenticated
using (
  auth.uid() is not null
  and private.has_pilot_link(null::text, null::uuid)
);

create policy indicadores_read_for_pilot_roles
on public.indicadores for select to authenticated
using (
  auth.uid() is not null
  and private.has_pilot_link(null::text, null::uuid)
);

create policy escopos_read_for_linked_roles
on public.escopos for select to authenticated
using (
  auth.uid() is not null
  and private.has_pilot_link(null::text, id)
);

create policy vinculos_read_own_allowed_roles
on public.vinculos for select to authenticated
using (
  auth.uid() is not null
  and actor_id = auth.uid()
  and papel in ('area_tecnica', 'cam')
);

create policy regras_read_for_pilot_roles
on public.regras for select to authenticated
using (
  auth.uid() is not null
  and private.has_pilot_link(null::text, null::uuid)
);

create policy entradas_read_for_assigned_scope
on public.entradas for select to authenticated
using (
  auth.uid() is not null
  and (
    private.has_pilot_link('area_tecnica', escopo_id)
    or private.has_pilot_link('cam', escopo_id)
  )
);

create policy resultados_read_for_assigned_scope
on public.resultados for select to authenticated
using (
  auth.uid() is not null
  and exists (
    select 1
    from public.entradas as e
    where e.id = resultados.entrada_id
      and (
        private.has_pilot_link('area_tecnica', e.escopo_id)
        or private.has_pilot_link('cam', e.escopo_id)
      )
  )
);

create policy eventos_auditoria_read_for_assigned_scope
on public.eventos_auditoria for select to authenticated
using (
  auth.uid() is not null
  and recurso_tipo = 'entrada'
  and exists (
    select 1
    from public.entradas as e
    where e.id = eventos_auditoria.recurso_id
      and (
        private.has_pilot_link('area_tecnica', e.escopo_id)
        or private.has_pilot_link('cam', e.escopo_id)
      )
  )
);

commit;
