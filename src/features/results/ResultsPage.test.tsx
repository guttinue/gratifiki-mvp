import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { groupContexts } from '../context/contextGroups';
import { ResultsPage } from './ResultsPage';
import { completeUnit, partialUnit, results, rpcClient, v3Context } from './resultsFixtures';

afterEach(cleanup);
const group = groupContexts([v3Context])[0];

describe('ResultsPage', () => {
  it('shows the big score in pt-BR and the delta against the previous month only when the server sent one', async () => {
    const { client, calls } = rpcClient(() => results(completeUnit));
    render(<ResultsPage client={client} group={group} />);
    expect(await screen.findByText('93,42')).toBeTruthy();
    expect(screen.getByText('/ 100')).toBeTruthy();
    expect(screen.getByText('+4,80 vs. setembro')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Como foi calculado?' }).length).toBeGreaterThan(0);
    // The shell renders the page title; the page does not repeat it.
    expect(screen.queryByRole('heading', { name: 'Resultados' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.queryByText('Pontuação parcial fictícia')).toBeNull();
    expect(screen.getByText('Pontuação fictícia')).toBeTruthy();
    expect(screen.getByText('Unidade Alfa · Outubro/2026', { selector: 'h3' })).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ name: 'get_unit_results', body: { p_contexto: { vinculoId: 'link', competenciaId: 'month', indicadorId: 'indicator' } } });
  });

  it('labels a partial score and shows no previous-month comparison at all, even if the server sent the previous score', async () => {
    const { client } = rpcClient(() => results(partialUnit));
    const { container } = render(<ResultsPage client={client} group={group} />);
    expect(await screen.findByText('Pontuação parcial fictícia')).toBeTruthy();
    expect(screen.getByText('70,00')).toBeTruthy();
    expect(container.textContent).not.toMatch(/vs\./);
    expect(container.textContent).not.toContain('92,51');
    expect(container.textContent).not.toMatch(/setembro/i);
  });

  it('shows no comparison for a complete unit whose delta is null', async () => {
    const { client } = rpcClient(() => results({ ...completeUnit, delta: null }));
    const { container } = render(<ResultsPage client={client} group={group} />);
    expect(await screen.findByText('93,42')).toBeTruthy();
    expect(container.textContent).not.toMatch(/vs\./);
  });

  it('formats a negative delta with a minus sign', async () => {
    const { client } = rpcClient(() => results({ ...completeUnit, points: '69.87', delta: '-17.97', previous: { points: '87.84', competencia: 'ACADEMIC-V3-2026-09' } }));
    render(<ResultsPage client={client} group={group} />);
    expect(await screen.findByText('−17,97 vs. setembro')).toBeTruthy();
  });

  it('lists every indicator with its value and points, never turning a pending item into zero', async () => {
    const { client } = rpcClient(() => results(partialUnit));
    render(<ResultsPage client={client} group={group} />);
    const table = await screen.findByRole('table', { name: 'Indicadores' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    const pending = within(rows[1]);
    expect(pending.getByText('DEMO-V1-01')).toBeTruthy();
    expect(pending.getByText('Registros conferidos')).toBeTruthy();
    expect(pending.getByText('Não enviada')).toBeTruthy();
    expect(pending.queryByRole('button', { name: 'Como foi calculado?' })).toBeNull();
    expect(rows[1].textContent).not.toMatch(/0,00/);
    expect(within(rows[2]).getByText('25,00')).toBeTruthy();
    expect(within(rows[3]).getByText('≤ 48')).toBeTruthy();
  });

  it('opens the calculation explainer with expression, effective weight and mode', async () => {
    const { client } = rpcClient(() => results(completeUnit));
    render(<ResultsPage client={client} group={group} />);
    const first = (await screen.findAllByRole('button', { name: 'Como foi calculado?' }))[0];
    expect(first.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    const explainer = screen.getByRole('region', { name: 'Cálculo de DEMO-V1-01' });
    expect(within(explainer).getByText('min(90 ÷ 95; 1) × 30')).toBeTruthy();
    expect(within(explainer).getByText(/Peso efetivo: 30/)).toBeTruthy();
    expect(within(explainer).getByText('Modo: ausências valem zero.')).toBeTruthy();
    expect(within(explainer).getByText(/= 28,42 pontos/)).toBeTruthy();
    fireEvent.click(within(explainer).getByRole('button', { name: 'Fechar' }));
    expect(screen.queryByRole('region', { name: 'Cálculo de DEMO-V1-01' })).toBeNull();
  });

  it('says when the effective weight was redistributed', async () => {
    const redistributed = { ...completeUnit, items: completeUnit.items.map((item, index) => index === 0 ? { ...item, effectiveWeight: '33.3333333333' } : item) };
    const { client } = rpcClient(() => ({ ...results(redistributed), mode: 'redistribuir' }));
    render(<ResultsPage client={client} group={group} />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Como foi calculado?' }))[0]);
    const explainer = screen.getByRole('region', { name: 'Cálculo de DEMO-V1-01' });
    expect(within(explainer).getByText(/redistribuídos/i)).toBeTruthy();
    expect(within(explainer).getByText('Modo: pesos redistribuídos.')).toBeTruthy();
    expect(within(explainer).getByText(/Peso efetivo: 33,3333333333/)).toBeTruthy();
  });

  it('offers one tab per unit for a district reader and switches without a new read', async () => {
    const { client, calls } = rpcClient(() => results(completeUnit, partialUnit));
    render(<ResultsPage client={client} group={groupContexts([{ ...v3Context, role: 'gestor_distrital', escopoCodigo: 'ACADEMIC-NORTE' }])[0]} />);
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map(tab => tab.textContent)).toEqual(['Unidade Alfa', 'Unidade Beta']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('93,42')).toBeTruthy();
    fireEvent.click(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Pontuação parcial fictícia')).toBeTruthy();
    expect(screen.queryByText('93,42')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('has no tabs for a single unit', async () => {
    const { client } = rpcClient(() => results(completeUnit));
    render(<ResultsPage client={client} group={group} />);
    await screen.findByText('93,42');
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows a recoverable alert, not a crash, when the read is denied', async () => {
    const { client, calls } = rpcClient(() => ({ code: '42501', message: 'access_denied' }), 403);
    render(<ResultsPage client={client} group={group} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível confirmar os resultados autorizados.');
    expect(screen.queryByText('93,42')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar resultados' }));
    await screen.findByRole('alert');
    expect(calls).toHaveLength(2);
  });

  it('explains an unavailable item decided by the CAM without points as a number', async () => {
    const unavailable = { ...completeUnit, items: [{ ...completeUnit.items[0], state: 'indisponivel' as const, reviewStatus: 'indisponivel' as const, inputValue: null, expression: null, points: '0' }, ...completeUnit.items.slice(1)] };
    const { client } = rpcClient(() => results(unavailable));
    render(<ResultsPage client={client} group={group} />);
    expect(await screen.findByText('Indisponível')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Como foi calculado?' })).toHaveLength(3);
  });

  it('shows the synthetic cycle state and a no-base unit without a score', async () => {
    const noBase = { ...partialUnit, points: null, noBase: true, items: [partialUnit.items[0]] };
    const { client } = rpcClient(() => ({ ...results(noBase), state: 'em_consolidacao' }));
    render(<ResultsPage client={client} group={group} />);
    expect(await screen.findByText('Sem base de cálculo')).toBeTruthy();
    // Spec §5.1: the hero shows the phase; the shell header keeps the competence state.
    expect(screen.getByText('Preliminar')).toBeTruthy();
  });

  it('hero shows the score, the phase and the comparison only when complete', async () => {
    const { client } = rpcClient(() => ({ ...results(completeUnit), state: 'fechada', publication: 'publicada_demo' }));
    const view = render(<ResultsPage client={client} group={group} />);
    const hero = (await screen.findByText('93,42')).closest('.hero') as HTMLElement;
    expect(within(hero).getByText('/ 100')).toBeTruthy();
    expect(within(hero).getByText('Publicado na demonstração')).toBeTruthy();
    expect(within(hero).getByText('+4,80 vs. setembro')).toBeTruthy();
    expect(within(hero).getByText('Indicadores aceitos').nextElementSibling?.textContent).toBe('4 de 4');
    expect(within(hero).getByText('Setembro').nextElementSibling?.textContent).toBe('88,62');
    view.unmount();
    const partial = rpcClient(() => results(partialUnit));
    render(<ResultsPage client={partial.client} group={group} />);
    const partialHero = (await screen.findByText('Pontuação parcial fictícia')).closest('.hero') as HTMLElement;
    expect(within(partialHero).getByText('Preliminar')).toBeTruthy();
    expect(partialHero.textContent).not.toMatch(/vs\.|Setembro/);
  });

  it('warns when an accepted item has no number', async () => {
    const unavailable = { ...completeUnit, items: [{ ...completeUnit.items[0], state: 'indisponivel' as const, reviewStatus: 'indisponivel' as const, inputValue: null, expression: null, points: '0' }, ...completeUnit.items.slice(1)] };
    const { client } = rpcClient(() => results(unavailable));
    render(<ResultsPage client={client} group={group} />);
    expect((await screen.findByText(/^1 indicador aceito como indisponível ou não aplicável não gera pontos numéricos\./)).className).toBe('notice warning');
  });

  it('draws an empty points bar for a zero weight instead of NaN', async () => {
    const zero = { ...completeUnit, items: completeUnit.items.map((item, index) => index === 0 ? { ...item, weight: '0', effectiveWeight: '0', points: '0' } : item) };
    const { client } = rpcClient(() => results(zero));
    const { container } = render(<ResultsPage client={client} group={group} />);
    await screen.findByText('93,42');
    expect((container.querySelector('.pts-bar span') as HTMLElement).style.width).toBe('0%');
  });

  it('units are chips that keep arrow-key selection', async () => {
    const { client } = rpcClient(() => results(completeUnit, partialUnit));
    render(<ResultsPage client={client} group={groupContexts([{ ...v3Context, role: 'gestor_distrital', escopoCodigo: 'ACADEMIC-NORTE' }])[0]} />);
    const alfa = await screen.findByRole('tab', { name: 'Unidade Alfa' });
    expect(screen.getByRole('tablist', { name: 'Unidade' }).className).toBe('chip-tabs');
    fireEvent.keyDown(alfa, { key: 'ArrowRight' });
    const beta = screen.getByRole('tab', { name: 'Unidade Beta' });
    expect(beta.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(beta);
  });

  it('opens on the requested unit', async () => {
    const { client } = rpcClient(() => results(completeUnit, partialUnit));
    render(<ResultsPage client={client} group={group} initialUnitId="beta" />);
    expect((await screen.findByRole('tab', { name: 'Unidade Beta' })).getAttribute('aria-selected')).toBe('true');
  });

  it('district panel shows one card per unit without a client-side average', async () => {
    const opened: string[] = [];
    const { client } = rpcClient((name) => name === 'get_unit_results' ? results(completeUnit, partialUnit) : { items: [], total: 0, page: 1, pageSize: 100 });
    const { container } = render(<ResultsPage client={client} group={group} panel="district" onOpenUnit={(id) => opened.push(id)} />);
    const units = await screen.findByRole('region', { name: 'Unidades do distrito' });
    const cards = within(units).getAllByRole('article');
    expect(cards.map((card) => within(card).getByRole('heading', { level: 4 }).textContent)).toEqual(['Unidade Alfa', 'Unidade Beta']);
    expect(within(cards[0]).getByText('4 de 4 indicadores aceitos')).toBeTruthy();
    expect(within(cards[0]).getByText('+4,80 vs. setembro')).toBeTruthy();
    expect(within(cards[1]).getByText('Pontuação parcial; comparação quando todos forem aceitos')).toBeTruthy();
    expect(cards[1].textContent).not.toMatch(/vs\./);
    const summary = screen.getByRole('region', { name: 'Resumo do distrito' });
    expect(within(summary).getByText('Unidades completas').parentElement?.textContent).toContain('1 de 2');
    expect(within(summary).getByText('Etapa do ciclo').parentElement?.textContent).toContain('Aberta');
    expect(container.textContent).not.toContain('Média das completas');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(await screen.findByRole('complementary', { name: 'Atividade recente' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhe Unidade Beta' }));
    expect(opened).toEqual(['beta']);
  });
});
