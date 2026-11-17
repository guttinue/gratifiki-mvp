import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { ActivityFeed, StackBar, StageTiles, TodoList, UnitCard } from './v4Parts';
import { groupContexts } from '../context/contextGroups';
import { countByStatus } from './displayNames';
import type { AuthorizedContext, PositionSummary } from '../pilot/types';

it('StageTiles names the strip and shows value and sub', () => {
  render(<StageTiles label="Etapas do fluxo" tiles={[{ label: 'Devolvidas', value: 1, sub: 'precisam de correção', tone: 'bad' }]} />);
  const strip = screen.getByRole('region', { name: 'Etapas do fluxo' });
  for (const text of ['Devolvidas', '1', 'precisam de correção']) expect(within(strip).getByText(text)).toBeTruthy();
});

it('TodoList marks only the first action primary and counts items', () => {
  const second = vi.fn();
  const { rerender } = render(<TodoList title="Onde agir" empty="Nada" items={[
    { tone: 'bad', title: 'A', action: { label: 'Abrir A', onClick: () => undefined } },
    { tone: 'info', title: 'B', sub: 'sub', action: { label: 'Abrir B', onClick: second } },
  ]} />);
  expect(screen.getByRole('region', { name: 'Onde agir' })).toBeTruthy(); // pill is aria-hidden
  expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('2');
  expect(screen.getByRole('button', { name: 'Abrir A' }).className).toContain('primary');
  expect(screen.getByRole('button', { name: 'Abrir B' }).className).not.toContain('primary');
  fireEvent.click(screen.getByRole('button', { name: 'Abrir B' }));
  expect(second).toHaveBeenCalledOnce();
  rerender(<TodoList title="Onde agir" empty="Nada a fazer" items={[]} />);
  expect(screen.getByText('Nada a fazer')).toBeTruthy();
});

it('StackBar reads its counts', () => {
  const row = (status: PositionSummary['status']) => ({ position: { status } as PositionSummary });
  render(<StackBar counts={countByStatus([row('validada'), row('devolvida')])} />);
  expect(screen.getByRole('img').getAttribute('aria-label')).toBe('1 aceita, 1 devolvida');
});

it('UnitCard exposes its action by name', () => {
  const open = vi.fn();
  render(<UnitCard title="Unidade Alfa" big="2 de 4" action={{ label: 'Abrir', ariaLabel: 'Abrir preenchimento Unidade Alfa', onClick: open }} />);
  fireEvent.click(screen.getByRole('button', { name: 'Abrir preenchimento Unidade Alfa' }));
  expect(open).toHaveBeenCalledOnce();
});

it('ActivityFeed shows five events and opens the history', async () => {
  const events = Array.from({ length: 7 }, (_, n) => ({ id: `e${n}`, occurredAt: new Date(Date.UTC(2026, 9, 1) + n * 60_000).toISOString(), action: 'posicao_validada', resourceId: 'p', version: 1, reason: `evento ${n}` }));
  const client = createClient('http://localhost:54321', 'key', { auth: { persistSession: false, storageKey: crypto.randomUUID() }, global: { fetch: async (url) => {
    const items = String(url).includes('get_scoped_audit') ? events : [];
    return new Response(JSON.stringify({ items, total: items.length, page: 1, pageSize: 100 }), { headers: { 'content-type': 'application/json' } });
  } } });
  const context: AuthorizedContext = { key: 'k', actorId: 'a', role: 'gestor_unidade', vinculoId: 'v', competenciaId: 'c', indicadorId: 'i', escopoId: 's', escopoCodigo: 'ACADEMIC-NORTE-1', competenciaCodigo: 'ACADEMIC-V3-2026-10', mode: 'academic', modelo: 3 };
  const open = vi.fn();
  render(<ActivityFeed client={client} group={groupContexts([context])[0]} onOpenHistory={open} />);
  const feed = screen.getByRole('complementary', { name: 'Atividade recente' });
  expect(await within(feed).findByText(/evento 6/)).toBeTruthy();
  expect(within(feed).getAllByRole('listitem')).toHaveLength(5);
  expect(within(feed).queryByText(/evento 1/)).toBeNull();
  fireEvent.click(within(feed).getByRole('button', { name: 'Ver histórico completo' }));
  expect(open).toHaveBeenCalledOnce();
});
