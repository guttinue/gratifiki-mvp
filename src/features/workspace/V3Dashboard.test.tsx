import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupContexts } from '../context/contextGroups';
import { rpcClient, v3Context } from '../results/resultsFixtures';
import type { AuthorizedContext, Role } from '../pilot/types';
import { AcademicV3Dashboard } from './DashboardPage';

afterEach(cleanup);
const states = ['ausente', 'rascunho', 'enviada', 'em_revisao', 'devolvida', 'validada', 'invalidada'];
// One get_dashboard answer per indicator context: 2 positions each.
function dashboard(counts: Record<string, number>) {
  const expected = 2;
  return { expected, received: 0, reviewed: 0, unavailable: 0, cards: [{ id: 'todas', label: 'todas', count: expected, filter: { page: 1, pageSize: 25 } },
    ...states.map(id => ({ id, label: id, count: counts[id] ?? 0, filter: { status: id, page: 1, pageSize: 25 } }))] };
}
function group(role: Role, indicators = 4) {
  const contexts: AuthorizedContext[] = Array.from({ length: indicators }, (_, n) => ({ ...v3Context, role, key: `${role}-${n}`, vinculoId: `link-${n}`, indicadorId: `ind-${n}` }));
  return groupContexts(contexts)[0];
}
const checklist = { version: 3, state: 'aberta', expected: 16, received: 10, reviewed: 9, unavailable: 1, decidedUnavailable: 0, notApplicable: 0, fullCoverage: true,
  canConsolidate: false, canClose: false, snapshotId: null, publication: 'nao_publicada', publicationId: null, ready: 9, blockers: [{ positionId: 'p', code: 'missing_submission', message: 'Envio ausente.' }] };

describe('AcademicV3Dashboard', () => {
  it('puts the returned entries first for the technical area, summing every indicator of the group', async () => {
    const onNavigate = vi.fn();
    const { client, calls } = rpcClient(name => name === 'get_dashboard' ? dashboard({ devolvida: 1, rascunho: 1, ausente: 1 }) : {});
    render(<AcademicV3Dashboard client={client} group={group('area_tecnica')} onNavigate={onNavigate} />);
    expect(await screen.findByText('Devolvida pelo revisor')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Corrigir 4 indicadores devolvidos' })).toBeTruthy();
    expect(calls.filter(call => call.name === 'get_dashboard')).toHaveLength(4);
    expect(new Set(calls.map(call => (call.body.p_contexto as { indicadorId: string }).indicadorId)).size).toBe(4);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir correção' }));
    expect(onNavigate).toHaveBeenCalledWith('preenchimento');
    const summary = screen.getByRole('region', { name: 'Situação das entradas' });
    expect(within(summary).getByText('Não enviadas').nextSibling?.textContent).toBe('8');
    expect(within(summary).getByText('Devolvidas').nextSibling?.textContent).toBe('4');
  });

  it('points the technical area at the pending entries when nothing was returned', async () => {
    const onNavigate = vi.fn();
    const { client } = rpcClient(() => dashboard({ ausente: 1, validada: 1 }));
    render(<AcademicV3Dashboard client={client} group={group('area_tecnica', 2)} onNavigate={onNavigate} />);
    expect(await screen.findByText('Próximo passo')).toBeTruthy();
    expect(screen.getByText('2 de 4 indicadores ainda não foram enviados.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir preenchimento' }));
    expect(onNavigate).toHaveBeenCalledWith('preenchimento');
    expect(screen.queryByText('Devolvida pelo revisor')).toBeNull();
  });

  it('confirms when the technical area has sent everything', async () => {
    const { client } = rpcClient(() => dashboard({ enviada: 1, validada: 1 }));
    render(<AcademicV3Dashboard client={client} group={group('area_tecnica', 1)} onNavigate={vi.fn()} />);
    expect(await screen.findByText('Tudo enviado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Abrir/ })).toBeNull();
  });

  it('shows the reviewer the pending entries per tab', async () => {
    const onNavigate = vi.fn();
    const { client } = rpcClient(() => dashboard({ enviada: 1, em_revisao: 1 }));
    render(<AcademicV3Dashboard client={client} group={group('revisor_tecnico', 2)} onNavigate={onNavigate} />);
    expect(await screen.findByRole('heading', { name: '4 entradas aguardam sua conferência' })).toBeTruthy();
    const tabs = screen.getByRole('region', { name: 'Pendências por aba' });
    expect(within(tabs).getByText('Aguardando você').nextSibling?.textContent).toBe('(4)');
    expect(within(tabs).getByText('Devolvidas').nextSibling?.textContent).toBe('(0)');
    expect(within(tabs).getByText('Aceitas').nextSibling?.textContent).toBe('(0)');
    expect(within(tabs).getByText('Todas').nextSibling?.textContent).toBe('(4)');
    fireEvent.click(screen.getByRole('button', { name: 'Conferir agora' }));
    expect(onNavigate).toHaveBeenCalledWith('conferencia');
  });

  it('shows the reviewer an empty queue', async () => {
    const { client } = rpcClient(() => dashboard({ validada: 2 }));
    render(<AcademicV3Dashboard client={client} group={group('revisor_tecnico', 1)} onNavigate={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Nada aguardando você' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Conferir agora' })).toBeNull();
  });

  it('shows the CAM the cycle steps and how many of the entries are ready', async () => {
    const onNavigate = vi.fn();
    const { client, calls } = rpcClient(name => name === 'get_cycle_checklist' ? checklist : {});
    render(<AcademicV3Dashboard client={client} group={group('cam')} onNavigate={onNavigate} />);
    expect(await screen.findByText('9 de 16 prontas')).toBeTruthy();
    expect(calls.map(call => call.name)).toEqual(['get_cycle_checklist']);
    const steps = within(screen.getByRole('list', { name: 'Etapas da competência' })).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(steps[0].textContent).toContain('Aberta');
    expect(steps[1].textContent).toContain('Consolidação');
    expect(steps[2].textContent).toContain('Fechada');
    expect(steps[3].textContent).toContain('Publicada');
    expect(screen.getByText('1 pendência impede o fechamento.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir ciclo e fechamento' }));
    expect(onNavigate).toHaveBeenCalledWith('ciclo');
  });

  it('marks the published step once the closed cycle was published', async () => {
    const { client } = rpcClient(() => ({ ...checklist, state: 'fechada', publication: 'publicada_demo', snapshotId: 's', publicationId: 'p', ready: 16, reviewed: 16, received: 16, blockers: [] }));
    render(<AcademicV3Dashboard client={client} group={group('cam')} onNavigate={vi.fn()} />);
    expect(await screen.findByText('16 de 16 prontas')).toBeTruthy();
    const steps = within(screen.getByRole('list', { name: 'Etapas da competência' })).getAllByRole('listitem');
    expect(steps[3].getAttribute('aria-current')).toBe('step');
    expect(steps[0].className).toContain('done');
    expect(screen.getByText('Nenhuma pendência impede o fechamento.')).toBeTruthy();
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
