import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupContexts } from '../context/contextGroups';
import { rpcClient, v3Context } from '../results/resultsFixtures';
import type { AuthorizedContext, Role } from '../pilot/types';
import { AcademicV3Dashboard } from './DashboardPage';

afterEach(cleanup);
function group(role: Role, indicators = 4) {
  const contexts: AuthorizedContext[] = Array.from({ length: indicators }, (_, n) => ({ ...v3Context, role, key: `${role}-${n}`, vinculoId: `link-${n}`, indicadorId: `ind-${n}` }));
  return groupContexts(contexts)[0];
}
// Units Alfa and Beta × the 4 DEMO indicators: one context (and one position) each.
// indicadorId runs against the code order, so the panel must sort by indicator code itself.
const indicators = [['DEMO-V1-01', 'Registros conferidos'], ['DEMO-V1-02', 'Rotinas concluídas'], ['DEMO-V1-03', 'Tempo de resposta'], ['DEMO-V1-04', 'Verificações realizadas']];
const units = [['beta', 'ACADEMIC-NORTE-2'], ['alfa', 'ACADEMIC-NORTE-1']];
function unitGroup(role: Role) {
  return groupContexts(units.flatMap(([id, code]) => indicators.map((_, n): AuthorizedContext =>
    ({ ...v3Context, role, key: `${id}-${n}`, vinculoId: `link-${id}-${n}`, indicadorId: `ind-${9 - n}`, escopoId: id, escopoCodigo: code }))))[0];
}
const unitCode = (id: string) => units.find(unit => unit[0] === id)![1];
// statuses: `${unit}:${indicator index}` → status; every other position has `fallback`.
// The unit batch carries the return reason; `reason: false` makes that read fail.
function unitClient(statuses: Record<string, string>, fallback = 'validada', reason: string | null | false = 'A fonte informada é de setembro.', cycle: object = checklist) {
  const status = (unit: string, n: number) => statuses[`${unit}:${n}`] ?? fallback;
  return rpcClient((name, body) => {
    if (name === 'get_cycle_checklist') return cycle;
    if (name === 'get_operational_positions') {
      const [, id, n] = /^link-(\w+)-(\d)$/.exec((body.p_contexto as { vinculoId: string }).vinculoId)!;
      const [code, label] = indicators[Number(n)];
      return { items: [{ id: `${id}-${n}`, escopoId: id, escopoCodigo: unitCode(id), escopoTipo: 'unidade', aplicavel: true, status: status(id, Number(n)), estadoDado: null,
        version: 1, revisionId: null, inputValue: null, resultValue: null, indicatorCode: code, indicatorName: label }], total: 1, page: 1, pageSize: 100 };
    }
    if (name === 'get_unit_batch' && reason !== false) {
      const unit = body.p_unidade_id as string;
      return { unitId: unit, unitCode: unitCode(unit), mode: 'zero', items: indicators.map(([code, label], n) => ({ positionId: `${unit}-${n}`, indicatorCode: code, name: label,
        meta: '10', direction: 'maior_melhor', weight: '25', decimals: 0, max: '100', unit: null, status: status(unit, n), version: 1, estadoDado: null, valor: null, fonte: null,
        motivo: null, periodoFonte: null, returnReason: status(unit, n) === 'devolvida' ? reason : null, revisionNumber: null })) };
    }
    return {};
  });
}
const checklist = { version: 3, state: 'aberta', expected: 16, received: 10, reviewed: 9, unavailable: 1, decidedUnavailable: 0, notApplicable: 0, fullCoverage: true,
  canConsolidate: false, canClose: false, snapshotId: null, publication: 'nao_publicada', publicationId: null, ready: 9, blockers: [{ positionId: 'p', code: 'missing_submission', message: 'Envio ausente.' }] };

describe('AcademicV3Dashboard', () => {
  it('names the returned unit, indicator and reason and opens that unit', async () => {
    const onOpenUnit = vi.fn();
    const { client, calls } = unitClient({ 'alfa:2': 'devolvida', 'beta:0': 'ausente' });
    render(<AcademicV3Dashboard client={client} group={unitGroup('area_tecnica')} onNavigate={vi.fn()} onOpenUnit={onOpenUnit} />);
    expect(await screen.findByRole('heading', { name: 'Corrigir Unidade Alfa · Tempo de resposta' })).toBeTruthy();
    expect(screen.getByText('Devolvida pelo revisor')).toBeTruthy();
    expect(screen.getByText('A fonte informada é de setembro.')).toBeTruthy();
    // Every read carries one context: one list per context, and the reason read only the returned unit's contexts.
    const lists = calls.filter(call => call.name === 'get_operational_positions');
    expect(new Set(lists.map(call => (call.body.p_contexto as { vinculoId: string }).vinculoId)).size).toBe(8);
    const batch = calls.filter(call => call.name === 'get_unit_batch');
    expect(batch).toHaveLength(1);
    expect(batch[0].body.p_unidade_id).toBe('alfa');
    expect((batch[0].body.p_contextos as { vinculoId: string }[]).map(c => c.vinculoId).sort()).toEqual(['link-alfa-0', 'link-alfa-1', 'link-alfa-2', 'link-alfa-3']);
    expect(calls.some(call => call.name === 'get_dashboard')).toBe(false);
    const action = screen.getByRole('button', { name: 'Abrir correção' });
    expect(action.className).toContain('primary');
    fireEvent.click(action);
    expect(onOpenUnit).toHaveBeenCalledWith('alfa');
    expect(screen.queryByRole('heading', { name: 'Painel' })).toBeNull();
  });

  it('keeps the correction step when the return reason cannot be read', async () => {
    const { client } = unitClient({ 'beta:1': 'devolvida' }, 'validada', false);
    render(<AcademicV3Dashboard client={client} group={unitGroup('area_tecnica')} onNavigate={vi.fn()} onOpenUnit={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Corrigir Unidade Beta · Rotinas concluídas' })).toBeTruthy();
    expect(screen.getByText('Abra o preenchimento para ver o motivo.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('points at the first unit still to fill', async () => {
    const onOpenUnit = vi.fn();
    const { client, calls } = unitClient({ 'beta:0': 'ausente', 'beta:1': 'rascunho', 'alfa:3': 'ausente', 'alfa:0': 'enviada' });
    render(<AcademicV3Dashboard client={client} group={unitGroup('area_tecnica')} onNavigate={vi.fn()} onOpenUnit={onOpenUnit} />);
    expect(await screen.findByRole('heading', { name: 'Preencher Unidade Alfa' })).toBeTruthy();
    expect(screen.getByText('Próximo passo')).toBeTruthy();
    expect(screen.getByText('3 de 8 indicadores ainda não foram enviados.')).toBeTruthy();
    expect(calls.some(call => call.name === 'get_unit_batch')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir preenchimento' }));
    expect(onOpenUnit).toHaveBeenCalledWith('alfa');
  });

  it('shows the status of every unit and indicator', async () => {
    const onOpenUnit = vi.fn();
    const { client } = unitClient({ 'beta:0': 'ausente', 'beta:1': 'devolvida', 'beta:2': 'enviada' });
    render(<AcademicV3Dashboard client={client} group={unitGroup('area_tecnica')} onNavigate={vi.fn()} onOpenUnit={onOpenUnit} />);
    const table = await screen.findByRole('region', { name: 'Situação por unidade' });
    expect(within(table).getByRole('heading', { name: 'Situação por unidade' })).toBeTruthy();
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Unidade', ...indicators.map(([code, label]) => `${code}${label}`), 'Aceitos', 'Ação']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(row => within(row).getAllByRole('cell')[0].textContent)).toEqual(['Unidade Alfa', 'Unidade Beta']);
    const beta = rows[1];
    expect(within(beta).getAllByRole('cell').map(cell => cell.textContent).slice(1, 6)).toEqual(['Não enviado', 'Devolvida', 'Aguardando conferência', 'Aceita', '1 de 4']);
    expect(within(beta).getByText('Devolvida').className).toContain('v3-st-devolvida');
    expect(within(rows[0]).getAllByRole('cell')[5].textContent).toBe('4 de 4');
    fireEvent.click(within(table).getByRole('button', { name: 'Abrir Unidade Beta' }));
    expect(onOpenUnit).toHaveBeenCalledWith('beta');
  });

  it('confirms when the technical area has sent everything', async () => {
    const { client } = unitClient({ 'alfa:0': 'enviada', 'beta:3': 'em_revisao' });
    render(<AcademicV3Dashboard client={client} group={unitGroup('area_tecnica')} onNavigate={vi.fn()} onOpenUnit={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Seus indicadores de outubro estão com o revisor' })).toBeTruthy();
    expect(screen.getByText('Tudo enviado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Abrir (correção|preenchimento)/ })).toBeNull();
  });

  it('tells the reviewer the first waiting entry and opens it', async () => {
    const onOpenPosition = vi.fn();const onNavigate = vi.fn();
    const { client, calls } = unitClient({ 'alfa:1': 'enviada', 'beta:0': 'em_revisao' });
    render(<AcademicV3Dashboard client={client} group={unitGroup('revisor_tecnico')} onNavigate={onNavigate} onOpenPosition={onOpenPosition} />);
    expect(await screen.findByRole('heading', { name: '2 entradas aguardam sua conferência' })).toBeTruthy();
    expect(screen.getByText('Próximo passo')).toBeTruthy();
    expect(screen.getByText('A primeira da fila é Unidade Alfa · Rotinas concluídas.')).toBeTruthy();
    expect(calls.some(call => call.name === 'get_unit_batch')).toBe(false);
    const action = screen.getByRole('button', { name: 'Conferir agora' });
    expect(action.className).toContain('primary');
    fireEvent.click(action);
    expect(onOpenPosition).toHaveBeenCalledWith('alfa-1');
    expect(onNavigate).not.toHaveBeenCalled();
    const table = screen.getByRole('region', { name: 'Situação por unidade' });
    expect(within(table).queryByRole('button', { name: /Abrir/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Pendências por aba' })).toBeNull();
  });

  it('shows the reviewer an empty queue', async () => {
    const { client } = unitClient({});
    render(<AcademicV3Dashboard client={client} group={unitGroup('revisor_tecnico')} onNavigate={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Nada aguardando você' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Conferir agora' })).toBeNull();
  });

  it('CAM painel shows steps, numbers, blockers and a read-only closing panel', async () => {
    const onNavigate = vi.fn();const onOpenPosition = vi.fn();
    const { client, calls } = unitClient({ 'alfa:0': 'ausente' }, 'validada', null, { ...checklist, blockers: [{ positionId: 'alfa-0', code: 'missing_submission', message: 'Envio ausente.' }] });
    render(<AcademicV3Dashboard client={client} group={unitGroup('cam')} onNavigate={onNavigate} onOpenPosition={onOpenPosition} />);
    expect(await screen.findByText('9 de 16 prontas')).toBeTruthy();
    expect(calls.filter(call => call.name === 'get_cycle_checklist')).toHaveLength(1);
    const steps = within(screen.getByRole('list', { name: 'Etapas da competência' })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(steps.map(step => step.querySelector('b')!.textContent)).toEqual(['Aberta', 'Consolidação', 'Fechada', 'Publicada']);
    for (const label of ['Esperadas', 'Recebidas', 'Prontas', 'Indisponíveis']) expect(screen.getByText(label)).toBeTruthy();
    const blockers = screen.getByRole('region', { name: 'O que impede o fechamento' });
    expect(within(blockers).getByRole('heading', { name: 'O que impede o fechamento' }).tagName).toBe('H3');
    expect(within(blockers).getByText('Unidade Alfa · DEMO-V1-01 Registros conferidos: Não enviado')).toBeTruthy();
    fireEvent.click(within(blockers).getByRole('button', { name: 'Ver entrada Unidade Alfa · DEMO-V1-01' }));
    expect(onOpenPosition).toHaveBeenCalledWith('alfa-0');
    const closing = screen.getByRole('region', { name: 'Fechamento e publicação' });
    expect(within(closing).getByText('Situação do ciclo: Aberta')).toBeTruthy();
    expect(within(closing).getByText('Publicação: Não publicada')).toBeTruthy();
    fireEvent.click(within(closing).getByRole('button', { name: 'Abrir ciclo e fechamento' }));
    expect(onNavigate).toHaveBeenCalledWith('ciclo');
    expect(screen.queryByRole('button', { name: 'Iniciar consolidação' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fechar ciclo' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('marks the published step once the closed cycle was published', async () => {
    const { client } = unitClient({}, 'validada', null, { ...checklist, state: 'fechada', publication: 'publicada_demo', snapshotId: 's', publicationId: 'p', ready: 16, reviewed: 16, received: 16, blockers: [] });
    render(<AcademicV3Dashboard client={client} group={unitGroup('cam')} onNavigate={vi.fn()} />);
    expect(await screen.findByText('16 de 16 prontas')).toBeTruthy();
    const steps = within(screen.getByRole('list', { name: 'Etapas da competência' })).getAllByRole('listitem');
    expect(steps[3].getAttribute('aria-current')).toBe('step');
    expect(steps[0].className).toContain('done');
    expect(screen.getByText('Nenhuma pendência impede o fechamento.')).toBeTruthy();
    expect(screen.getByText('Publicação: Publicada na demonstração')).toBeTruthy();
  });

  it('reports a failed read and retries', async () => {
    const { client, calls } = rpcClient(() => ({ code: '42501', message: 'access_denied' }), 403);
    render(<AcademicV3Dashboard client={client} group={group('area_tecnica', 1)} onNavigate={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível confirmar os contadores autorizados.');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar painel' }));
    await screen.findByRole('alert');
    expect(calls).toHaveLength(2);
  });
});
