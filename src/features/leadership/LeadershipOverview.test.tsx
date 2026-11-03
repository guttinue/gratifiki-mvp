import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { rpcClient, v3Context } from '../results/resultsFixtures';
import { LeadershipPage } from './LeadershipPage';

afterEach(cleanup);
const context = { ...v3Context, role: 'lideranca' as const, escopoCodigo: 'ACADEMIC-NORTE' };
const overview = { acceptedPercent: '68.75', mode: 'zero', districts: [
  { districtCode: 'ACADEMIC-NORTE', average: '93.42', completeUnits: 1, totalUnits: 2 },
  { districtCode: 'ACADEMIC-SUL', average: null, completeUnits: 0, totalUnits: 2 }],
  attention: [{ unitCode: 'ACADEMIC-NORTE-1', pending: 3 }, { unitCode: 'ACADEMIC-NORTE-2', pending: 1 }] };

it('shows the model-3 aggregate overview: accepted share, where to act and the district averages, with no person', async () => {
  const { client, calls } = rpcClient(() => overview);
  render(<LeadershipPage client={client} context={context} />);
  expect(await screen.findByText('68,75%')).toBeTruthy();
  expect(screen.getByRole('progressbar', { name: 'Entradas aceitas' }).getAttribute('aria-valuenow')).toBe('68.75');
  const attention = screen.getByRole('region', { name: 'Onde agir' });
  expect(within(attention).getByText('Unidade Alfa: 3 entradas pendentes.')).toBeTruthy();
  expect(within(attention).getByText('Unidade Beta: 1 entrada pendente.')).toBeTruthy();
  const rows = within(screen.getByRole('table', { name: 'Médias por distrito' })).getAllByRole('row');
  expect(within(rows[1]).getByText('Distrito Norte')).toBeTruthy();
  expect(within(rows[1]).getByText('1 de 2')).toBeTruthy();
  expect(within(rows[1]).getByText('93,42')).toBeTruthy();
  expect(within(rows[2]).getByText('Distrito Sul')).toBeTruthy();
  expect(within(rows[2]).getByText('Aguardando unidades completas')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Agregados de unidades publicadas' })).toBeNull();
  expect(screen.getByText(/Indisponível ou não se aplica entra com 0 pontos neste conjunto \(modo zero\), após decisão da CAM\./)).toBeTruthy();
  expect(screen.queryByText(/vira zero/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Detalhe|Entrada|Avaliação própria/ })).toBeNull();
  expect(calls).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar agregados' }));
  await screen.findByText('68,75%');
  expect(calls).toHaveLength(2);
});

it('says nothing needs action when no entry is pending', async () => {
  const { client } = rpcClient(() => ({ ...overview, acceptedPercent: '100.00', attention: [] }));
  render(<LeadershipPage client={client} context={context} />);
  expect(await screen.findByText('100,00%')).toBeTruthy();
  expect(screen.getByText('Nenhuma pendência nas unidades.')).toBeTruthy();
});

it('reports a failed aggregate read', async () => {
  const { client } = rpcClient(() => ({ code: '42501', message: 'access_denied' }), 403);
  render(<LeadershipPage client={client} context={context} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível confirmar os agregados autorizados.');
});

it('says the weight is redistributed in redistribuir mode', async () => {
  const { client } = rpcClient(() => ({ ...overview, mode: 'redistribuir' }));
  render(<LeadershipPage client={client} context={context} />);
  expect(await screen.findByText(/Indisponível ou não se aplica não pontua; o peso é redistribuído entre os demais indicadores, após decisão da CAM\./)).toBeTruthy();
});
