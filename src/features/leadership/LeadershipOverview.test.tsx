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

// LI-01 to LI-03. Numbers come from the fixture above (preflight F10): Norte 1 of 2 complete, Sul 0 of 2.
const tile=(label:string)=>within(screen.getByRole('region',{name:'Resumo agregado'})).getByText(label).parentElement?.querySelector('.tile-n')?.textContent;
it('summary strip and where to act', async () => {
  const { client, calls } = rpcClient(() => overview);
  const { container } = render(<LeadershipPage client={client} context={{ ...context, competenciaEstado: 'aberta' }} />);
  expect(await screen.findByText('68 %')).toBeTruthy();
  expect(tile('Entradas aceitas')).toBe('68 %');
  expect(tile('Etapa do ciclo')).toBe('Aberta');
  expect(tile('Unidades com pendência')).toBe('2');
  expect(tile('Unidades completas')).toBe('1 de 4');
  // The shell renders the page title and subtitle.
  expect(screen.queryByRole('heading', { name: 'Visão agregada' })).toBeNull();
  const attention = screen.getByRole('region', { name: 'Onde agir' });
  expect(within(attention).getByText('Unidade Alfa: 3 entradas pendentes.')).toBeTruthy();
  expect(within(attention).getByText('Unidade Beta: 1 entrada pendente.')).toBeTruthy();
  expect(within(attention).queryByRole('button')).toBeNull();
  expect(screen.getAllByText('Converse com a gestão distrital antes do fechamento.')).toHaveLength(1);
  expect(screen.getByText('Unidades com pendência').querySelector('.dot')?.className).toContain('t-warn');
  // LI-03: the district table becomes cards in a region with the same name.
  const districts = screen.getByRole('region', { name: 'Médias por distrito' });
  const cards = within(districts).getAllByRole('article');
  expect(within(cards[0]).getByRole('heading', { level: 4 }).textContent).toBe('Distrito Norte');
  expect(within(cards[0]).getByText('93,42')).toBeTruthy();
  expect(within(cards[0]).getByText('1 de 2 unidades completas')).toBeTruthy();
  expect(within(cards[1]).getByRole('heading', { level: 4 }).textContent).toBe('Distrito Sul');
  expect(within(cards[1]).getByText('–')).toBeTruthy();
  expect(cards[1].textContent).not.toContain('/ 100');
  expect(within(cards[1]).getByText('Aguardando unidades completas')).toBeTruthy();
  expect(screen.queryByRole('table')).toBeNull();
  expect(container.textContent).not.toMatch(/vs\./);
  expect(screen.queryByRole('complementary', { name: 'Atividade recente' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Agregados de unidades publicadas' })).toBeNull();
  expect(screen.getByText(/Indisponível ou não se aplica entra com 0 pontos neste conjunto \(modo zero\), após decisão da CAM\./)).toBeTruthy();
  expect(screen.queryByText(/vira zero/)).toBeNull();
  expect(screen.queryByRole('button', { name: /Detalhe|Entrada|Avaliação própria/ })).toBeNull();
  expect(calls).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Atualizar agregados' }));
  await screen.findByText('68 %');
  expect(calls).toHaveLength(2);
});

it('says nothing needs action when no entry is pending', async () => {
  const { client } = rpcClient(() => ({ ...overview, acceptedPercent: '100.00', attention: [] }));
  render(<LeadershipPage client={client} context={context} />);
  expect(await screen.findByText('100 %')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: 'Onde agir' })).getByText('Nenhuma pendência.')).toBeTruthy();
  expect(tile('Unidades com pendência')).toBe('0');
  expect(screen.getByText('Unidades com pendência').querySelector('.dot')?.className).toContain('t-ok');
  expect(screen.queryByText('Converse com a gestão distrital antes do fechamento.')).toBeNull();
  expect(screen.queryByText(/Etapa do ciclo/)).toBeNull();
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

it.each([['93.75', '93 %'], ['99.38', '99 %'], ['99.99', '99 %']])('rounds the accepted share %s down to %s while entries are pending', async (percent, shown) => {
  const { client } = rpcClient(() => ({ ...overview, acceptedPercent: percent }));
  render(<LeadershipPage client={client} context={context} />);
  expect(await screen.findByText(shown)).toBeTruthy();
  expect(tile('Entradas aceitas')).toBe(shown);
});
