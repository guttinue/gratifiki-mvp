import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StackBar, StageTiles, TodoList, UnitCard } from './v4Parts';
import { countByStatus } from './displayNames';
import type { PositionSummary } from '../pilot/types';

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
