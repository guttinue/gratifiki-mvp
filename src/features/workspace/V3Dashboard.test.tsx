import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupContexts } from '../context/contextGroups';
import { completeUnit, partialUnit, results, rpcClient, v3Context } from '../results/resultsFixtures';
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
// The CAM sees the 16 entries: four units × four indicators.
const allUnits = [...units, ['gama', 'ACADEMIC-SUL-1'], ['delta', 'ACADEMIC-SUL-2']];
function unitGroup(role: Role, list = units) {
  return groupContexts(list.flatMap(([id, code]) => indicators.map((_, n): AuthorizedContext =>
    ({ ...v3Context, role, key: `${id}-${n}`, vinculoId: `link-${id}-${n}`, indicadorId: `ind-${9 - n}`, escopoId: id, escopoCodigo: code, competenciaEstado: 'aberta' }))))[0];
}
const unitCode = (id: string) => allUnits.find(unit => unit[0] === id)![1];
// statuses: `${unit}:${indicator index}` → status; every other position has `fallback`.
// The unit batch carries the return reason; `reason: false` makes that read fail.
function unitClient(statuses: Record<string, string>, fallback = 'validada', reason: string | null | false = 'A fonte informada é de setembro.', cycle: object = checklist, unitResults: object = {}) {
  const status = (unit: string, n: number) => statuses[`${unit}:${n}`] ?? fallback;
  return rpcClient((name, body) => {
    if (name === 'get_cycle_checklist') return cycle;
    if (name === 'get_unit_results') return unitResults;
    if (name === 'get_operational_positions') {
      const [, id, n] = /^link-(\w+)-(\d)$/.exec((body.p_contexto as { vinculoId: string }).vinculoId)!;
      const [code, label] = indicators[Number(n)];
      return { items: [{ id: `${id}-${n}`, escopoId: id, escopoCodigo: unitCode(id), escopoTipo: 'unidade', aplicavel: true, status: status(id, Number(n)), estadoDado: null,
        version: 1, revisionId: null, inputValue: null, resultValue: null, indicatorCode: code, indicatorName: label }], total: 1, page: 1, pageSize: 100 };
    }
    if (name === 'get_unit_batch' && reason !== false) {
      const unit = body.p_unidade_id as string;
      return { unitId: unit, unitCode: unitCode(unit), mode: 'zero', items: indicators.map(([code, label], n) => ({ positionId: `${unit}-${n}`, indicatorCode: code, name: label,
        meta: '10', direction: 'maior_melhor', weight: '25', decimals: 0, max: '100', unit: null, status: status(unit, n), version: 1, estadoDado: null, valor: status(unit, n) === 'rascunho' ? '12.5' : null, fonte: null,
        motivo: null, periodoFonte: null, returnReason: status(unit, n) === 'devolvida' ? reason : null, revisionNumber: null })) };
    }
    return {};
  });
}
const checklist = { version: 3, state: 'aberta', expected: 16, received: 10, reviewed: 9, unavailable: 1, decidedUnavailable: 0, notApplicable: 0, fullCoverage: true,
  canConsolidate: false, canClose: false, snapshotId: null, publication: 'nao_publicada', publicationId: null, ready: 9, blockers: [{ positionId: 'p', code: 'missing_submission', message: 'Envio ausente.' }] };

describe('AcademicV3Dashboard', () => {
  // Alfa: 01 rascunho, 02 enviada, 03 devolvida, 04 em revisão; Beta: 02 não enviado, the rest accepted.
  const flow = { 'alfa:0': 'rascunho', 'alfa:1': 'enviada', 'alfa:2': 'devolvida', 'alfa:3': 'em_revisao', 'beta:1': 'ausente' };
  const technical = (client: ReturnType<typeof unitClient>['client'], onOpenUnit = vi.fn()) =>
    render(<AcademicV3Dashboard client={client} group={unitGroup('area_tecnica')} onNavigate={vi.fn()} onOpenUnit={onOpenUnit} />);

  it('counts the five stages of the technical flow', async () => {
    technical(unitClient(flow).client);
    const stages = await screen.findByRole('region', { name: 'Etapas do fluxo' });
    const tile = (label: string) => within(stages).getByText(label).closest('.tile')!;
    expect(tile('Não enviados').textContent).toBe('Não enviados1ainda sem valor');
    expect(tile('Rascunhos').textContent).toBe('Rascunhos1salvos, não enviados');
    expect(tile('Devolvidas').textContent).toBe('Devolvidas1precisam de correção');
    expect(tile('Em conferência').textContent).toBe('Em conferência21 aguardando · 1 em análise');
    expect(tile('Aceitas').textContent).toBe('Aceitas3de 8 do seu escopo');
  });

  it('orders to-dos returned first, then drafts, then missing, and only the first is primary', async () => {
    const { client, calls } = unitClient(flow);
    technical(client);
    const todo = await screen.findByRole('region', { name: 'Para fazer' });
    const items = within(todo).getAllByRole('listitem');
    expect(items.map(item => item.querySelector('strong')!.textContent)).toEqual([
      'Corrigir Unidade Alfa · DEMO-V1-03 Tempo de resposta',
      'Enviar o rascunho de Unidade Alfa · DEMO-V1-01 Registros conferidos',
      'Preencher Unidade Beta · DEMO-V1-02 Rotinas concluídas',
    ]);
    expect(within(todo).getByText('Devolvida pelo revisor técnico: A fonte informada é de setembro.')).toBeTruthy();
    expect(within(todo).getByText('Valor salvo: 12,5. Ainda não está com o revisor.')).toBeTruthy();
    expect(within(todo).getByText('Meta: no mínimo 10')).toBeTruthy();
    expect(within(todo).getAllByRole('button').map(button => [button.textContent, button.getAttribute('aria-label'), button.classList.contains('primary')])).toEqual([
      ['Corrigir', 'Corrigir DEMO-V1-03 · Unidade Alfa', true],
      ['Revisar e enviar', 'Revisar e enviar DEMO-V1-01 · Unidade Alfa', false],
      ['Preencher', 'Preencher DEMO-V1-02 · Unidade Beta', false]]);
    // One batch per unit with something to do, each read with that unit's contexts only.
    const batches = calls.filter(call => call.name === 'get_unit_batch');
    expect(batches.map(call => call.body.p_unidade_id).sort()).toEqual(['alfa', 'beta']);
    for (const batch of batches) for (const context of batch.body.p_contextos as { vinculoId: string }[]) expect(context.vinculoId).toContain(`link-${batch.body.p_unidade_id as string}-`);
  });

  it('keeps the to-dos without their detail when a unit batch cannot be read', async () => {
    technical(unitClient({ 'alfa:2': 'devolvida' }, 'validada', false).client);
    const todo = await screen.findByRole('region', { name: 'Para fazer' });
    expect(within(todo).getByText('Corrigir Unidade Alfa · DEMO-V1-03 Tempo de resposta')).toBeTruthy();
    expect(within(todo).queryByText(/Devolvida pelo revisor/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says there is nothing to do when everything was sent, and lists no to-do outside the open month', async () => {
    technical(unitClient({ 'alfa:0': 'enviada' }).client);
    expect(await screen.findByText('Nada pendente com você.')).toBeTruthy();
    expect(screen.getByText('Se algo for devolvido, aparece aqui com o motivo.')).toBeTruthy();
    cleanup();
    const closed = groupContexts(unitGroup('area_tecnica').contexts.map(context => ({ ...context, competenciaEstado: 'em_consolidacao' as const })))[0];
    const { client, calls } = unitClient(flow);
    render(<AcademicV3Dashboard client={client} group={closed} onNavigate={vi.fn()} onOpenUnit={vi.fn()} />);
    expect(await screen.findByText('Nada pendente com você.')).toBeTruthy();
    // No to-do shows outside the open month, so no unit batch is read for one.
    expect(calls.some(call => call.name === 'get_unit_batch')).toBe(false);
  });

  it('Corrigir opens the fill screen on the correction field', async () => {
    const onOpenUnit = vi.fn();
    technical(unitClient(flow).client, onOpenUnit);
    fireEvent.click(await screen.findByRole('button', { name: 'Corrigir DEMO-V1-03 · Unidade Alfa' }));
    expect(onOpenUnit).toHaveBeenCalledWith('alfa', { positionId: 'alfa-2', field: 'explicacao' });
    fireEvent.click(screen.getByRole('button', { name: 'Revisar e enviar DEMO-V1-01 · Unidade Alfa' }));
    expect(onOpenUnit).toHaveBeenLastCalledWith('alfa', { positionId: 'alfa-0', field: 'valor' });
    fireEvent.click(screen.getByRole('button', { name: 'Preencher DEMO-V1-02 · Unidade Beta' }));
    expect(onOpenUnit).toHaveBeenLastCalledWith('beta', { positionId: 'beta-1', field: 'valor' });
  });

  it('opening a to-do or a unit runs no command', async () => {
    const { client, calls } = unitClient(flow);
    technical(client);
    fireEvent.click(await screen.findByRole('button', { name: 'Corrigir DEMO-V1-03 · Unidade Alfa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir preenchimento Unidade Beta' }));
    for (const name of ['save_position_draft', 'submit_unit_batch', 'start_position_review', 'review_position']) expect(calls.map(call => call.name)).not.toContain(name);
  });

  it('shows one card per unit with progress and a stacked bar', async () => {
    const onOpenUnit = vi.fn();
    technical(unitClient({ 'alfa:0': 'rascunho', 'alfa:1': 'enviada', 'alfa:2': 'devolvida' }).client, onOpenUnit);
    const units = await screen.findByRole('region', { name: 'Suas unidades' });
    const cards = within(units).getAllByRole('article');
    expect(cards.map(card => within(card).getByRole('heading', { level: 4 }).textContent)).toEqual(['Unidade Alfa', 'Unidade Beta']);
    const alfa = cards[0];
    expect(alfa.textContent).toContain('2 de 4 enviados');
    expect(within(alfa).getByText('1 devolvida')).toBeTruthy();
    expect(within(alfa).getByRole('img', { name: /1 aceita/ }).getAttribute('aria-label')).toBe('1 aceita, 1 aguardando conferência, 1 devolvida, 1 rascunho');
    expect(alfa.textContent).toContain('1 aceita · 1 com o revisor');
    expect(cards[1].textContent).toContain('4 de 4 enviados');
    expect(within(cards[1]).queryByText(/devolvida/)).toBeNull();
    fireEvent.click(within(units).getByRole('button', { name: 'Abrir preenchimento Unidade Beta' }));
    expect(onOpenUnit).toHaveBeenCalledWith('beta');
    expect(screen.queryByRole('region', { name: 'Situação por unidade' })).toBeNull();
  });

  it('shows the recent activity beside the technical painel and opens the history', async () => {
    const onOpenHistory = vi.fn();
    const { client } = unitClient(flow);
    render(<AcademicV3Dashboard client={client} group={unitGroup('area_tecnica')} onNavigate={vi.fn()} onOpenUnit={vi.fn()} onOpenHistory={onOpenHistory} />);
    const activity = await screen.findByRole('complementary', { name: 'Atividade recente' });
    expect(activity.closest('.dash')).toBeTruthy();
    fireEvent.click(within(activity).getByRole('button', { name: 'Ver histórico completo' }));
    expect(onOpenHistory).toHaveBeenCalled();
  });

  // RV-01 to RV-04 (the old "first waiting entry" test went with the Próximo passo it checked, RV-02).
  it('reviewer to-dos list waiting and in-review entries', async () => {
    const onOpenPosition = vi.fn();const onOpenUnit = vi.fn();
    const { client, calls } = unitClient({ 'alfa:1': 'enviada', 'beta:0': 'em_revisao' });
    render(<AcademicV3Dashboard client={client} group={unitGroup('revisor_tecnico')} onNavigate={vi.fn()} onOpenPosition={onOpenPosition} onOpenUnit={onOpenUnit} />);
    const todo = await screen.findByRole('region', { name: 'Para fazer' });
    expect(within(todo).getAllByRole('listitem').map(item => [item.querySelector('strong')!.textContent, item.querySelector('.todo-txt span')!.textContent])).toEqual([
      ['Conferir Unidade Alfa · DEMO-V1-02 Rotinas concluídas', 'Aguardando conferência'],
      ['Conferir Unidade Beta · DEMO-V1-01 Registros conferidos', 'Em conferência']]);
    const stages = screen.getByRole('region', { name: 'Etapas do fluxo' });
    const count = (label: string) => within(stages).getByText(label).closest('.tile')!.querySelector('.tile-n')!.textContent;
    expect(['Com a área técnica', 'Para conferir', 'Em conferência', 'Devolvidas', 'Aceitas'].map(count)).toEqual(['0', '1', '1', '0', '6']);
    expect(within(stages).getByText('Para conferir').closest('.tile')!.querySelector('.tile-sub')!.textContent).toBe('aguardando início da conferência');
    fireEvent.click(within(todo).getByRole('button', { name: 'Conferir DEMO-V1-02 · Unidade Alfa' }));
    expect(onOpenPosition).toHaveBeenCalledWith('alfa-1');
    const units = screen.getByRole('region', { name: 'Unidades do distrito' });
    const beta = within(units).getAllByRole('article')[1];
    expect(beta.textContent).toContain('3 de 4 aceitas');
    expect(within(beta).getByText('1 para conferir')).toBeTruthy();
    fireEvent.click(within(units).getByRole('button', { name: 'Conferir unidade Unidade Beta' }));
    expect(onOpenUnit).toHaveBeenCalledWith('beta');
    expect(screen.getByRole('complementary', { name: 'Atividade recente' })).toBeTruthy();
    for (const name of ['get_unit_batch', 'start_position_review', 'review_position']) expect(calls.map(call => call.name)).not.toContain(name);
  });

  it('shows the reviewer an empty queue', async () => {
    const { client } = unitClient({});
    render(<AcademicV3Dashboard client={client} group={unitGroup('revisor_tecnico')} onNavigate={vi.fn()} onOpenUnit={vi.fn()} />);
    expect(await screen.findByText('Nada aguardando você.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Conferir / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver entradas Unidade Alfa' })).toBeTruthy();
  });

  // CAM-01 (replaces the painel that repeated the cycle screen). F11: 2 ausente, 1 devolvida, 1 enviada, 1 em_revisao, 11 validada.
  const camStatuses = { 'alfa:0': 'ausente', 'beta:1': 'ausente', 'alfa:2': 'devolvida', 'gama:3': 'enviada', 'delta:0': 'em_revisao' };
  const camCycle = { ...checklist, ready: 11, received: 14 };
  const cam = (cycle: object, statuses: Record<string, string> = camStatuses, unitResults: object = results(completeUnit, partialUnit)) => {
    const onNavigate = vi.fn(); const onOpenUnit = vi.fn(); const onOpenPosition = vi.fn();
    const { client, calls } = unitClient(statuses, 'validada', null, cycle, unitResults);
    render(<AcademicV3Dashboard client={client} group={unitGroup('cam', allUnits)} onNavigate={onNavigate} onOpenUnit={onOpenUnit} onOpenPosition={onOpenPosition} />);
    return { calls, onNavigate, onOpenUnit, onOpenPosition };
  };

  it('CAM painel is read-only and points to the cycle', async () => {
    const { calls, onNavigate, onOpenUnit } = cam(camCycle);
    const stages = await screen.findByRole('region', { name: 'Etapas do fluxo' });
    const tile = (label: string) => within(stages).getByText(label).closest('.tile')!;
    expect(['Não enviados', 'Para conferir', 'Em conferência', 'Devolvidas', 'Aceitas'].map(label => tile(label).querySelector('.tile-n')!.textContent)).toEqual(['2', '1', '1', '1', '11']);
    expect(tile('Não enviados').querySelector('.tile-sub')!.textContent).toBe('com a área técnica');
    expect(tile('Aceitas').querySelector('.tile-sub')!.textContent).toBe('de 16 entradas');
    const todo = screen.getByRole('region', { name: 'Para fazer' });
    expect(within(todo).getByText('5 entradas impedem a consolidação')).toBeTruthy();
    fireEvent.click(within(todo).getByRole('button', { name: 'Ver o que falta' }));
    expect(onNavigate).toHaveBeenCalledWith('ciclo');
    const cards = within(screen.getByRole('region', { name: 'Unidades' })).getAllByRole('article');
    expect(cards.map(card => within(card).getByRole('heading', { level: 4 }).textContent)).toEqual(['Unidade Alfa', 'Unidade Beta', 'Unidade Gama', 'Unidade Delta']);
    const [alfa, beta, gama] = cards;
    expect(alfa.querySelector('.big')!.textContent).toBe('93,42 / 100');
    expect(beta.querySelector('.big')!.textContent).toBe('70,00 / 100 parcial');
    // A unit outside the results keeps its card without a score.
    expect(gama.querySelector('.big')!.textContent).toBe('');
    expect(within(alfa).getByText('2 pendentes')).toBeTruthy();
    expect(alfa.textContent).toContain('2 de 4 aceitas');
    expect(within(alfa).getByRole('img').getAttribute('aria-label')).toContain('1 devolvida, 1 não enviado');
    fireEvent.click(within(alfa).getByRole('button', { name: 'Ver resultado Unidade Alfa' }));
    expect(onOpenUnit).toHaveBeenCalledWith('alfa');
    expect(screen.getByRole('complementary', { name: 'Atividade recente' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Iniciar consolidação' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    for (const name of ['transition_cycle', 'publish_cycle_demo', 'decide_unavailability']) expect(calls.map(call => call.name)).not.toContain(name);
    const read = (name: string) => calls.filter(call => call.name === name);
    expect(read('get_cycle_checklist')).toHaveLength(1);
    expect(read('get_unit_results')).toHaveLength(1);
    expect(read('get_unit_results')[0].body.p_contexto).toEqual(read('get_cycle_checklist')[0].body.p_contexto);
  });

  it('CAM painel keeps its cards when the results cannot be read, and says when a unit is complete', async () => {
    cam(camCycle, { 'beta:1': 'ausente' }, { code: 'x' });
    const units = await screen.findByRole('region', { name: 'Unidades' });
    const alfa = within(units).getAllByRole('article')[0];
    expect(within(alfa).getByText('Completa')).toBeTruthy();
    expect(alfa.querySelector('.big')!.textContent).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it.each([
    [{ ready: 16, canConsolidate: true, blockers: [] }, 'Todas as 16 entradas estão prontas', 'Abrir ciclo e fechamento'],
    [{ state: 'em_consolidacao', ready: 16, blockers: [] }, 'Revisar e fechar outubro', 'Abrir ciclo e fechamento'],
    [{ state: 'fechada', ready: 16, snapshotId: 's', blockers: [] }, 'Publicar outubro', 'Abrir ciclo e fechamento'],
  ])('CAM painel names the next cycle step and only navigates: %#', async (extra, title, button) => {
    const { calls, onNavigate } = cam({ ...checklist, ...extra }, {});
    const todo = await screen.findByRole('region', { name: 'Para fazer' });
    expect(within(todo).getAllByRole('listitem')[0].querySelector('strong')!.textContent).toBe(title);
    fireEvent.click(within(todo).getAllByRole('button', { name: button })[0]);
    expect(onNavigate).toHaveBeenCalledWith('ciclo');
    for (const name of ['transition_cycle', 'publish_cycle_demo']) expect(calls.map(call => call.name)).not.toContain(name);
  });

  it('CAM painel offers the export once the cycle was published', async () => {
    cam({ ...checklist, state: 'fechada', publication: 'publicada_demo', snapshotId: 's', publicationId: 'p', ready: 16, blockers: [] }, {});
    const todo = await screen.findByRole('region', { name: 'Para fazer' });
    expect(within(todo).getAllByRole('listitem').map(item => item.querySelector('strong')!.textContent)).toEqual(['Exportar a competência em CSV']);
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
