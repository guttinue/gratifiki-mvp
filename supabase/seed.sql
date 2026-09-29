-- Deterministic demo data only. These values are synthetic and do not encode SESAU rules.
insert into public.competencias (id, codigo, referencia, estado)
values ('c0de0000-0000-4000-8000-000000000001', 'DEMO-2026-09', date '2026-09-15', 'aberta')
on conflict (codigo) do nothing;

insert into public.indicadores (id, codigo)
values ('c0de0000-0000-4000-8000-000000000002', 'DEMO-01')
on conflict (codigo) do nothing;

insert into public.escopos (id, codigo)
values ('c0de0000-0000-4000-8000-000000000003', 'DEMO-ESCOPO-01')
on conflict (codigo) do nothing;

insert into public.regras (id, indicador_id, versao, fator, vigencia_inicio, vigencia_fim)
select 'c0de0000-0000-4000-8000-000000000004', i.id, 1, 0.8, date '2026-01-01', date '2026-12-31'
from public.indicadores i
where i.codigo = 'DEMO-01'
on conflict (indicador_id, versao) do nothing;
