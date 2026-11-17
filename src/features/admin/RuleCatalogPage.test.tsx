import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { groupContexts } from '../context/contextGroups';
import { rpcClient, v3Context } from '../results/resultsFixtures';
import type { RuleCatalog } from '../results/resultsApi';
import { RuleCatalogPage } from './RuleCatalogPage';

afterEach(cleanup);
const group = groupContexts([{ ...v3Context, role: 'administrador', escopoCodigo: 'ACADEMIC-NORTE' }])[0];
const catalog: RuleCatalog = { ruleSets: [{ id: 'set', code: 'DEMO', version: 1, mode: 'zero', synthetic: true, validFrom: '2026-09-01', reference: 'DEMO-v1 · regra fictícia acadêmica', inUse: true,
  items: [
    { indicatorCode: 'DEMO-V1-01', name: 'Registros conferidos', meta: '95', direction: 'maior_melhor', decimals: 2, maximum: '100', unit: '%', weight: '30' },
    { indicatorCode: 'DEMO-V1-02', name: 'Rotinas concluídas', meta: '20', direction: 'maior_melhor', decimals: 0, maximum: '999999', unit: null, weight: '25' },
    { indicatorCode: 'DEMO-V1-03', name: 'Tempo de resposta', meta: '48', direction: 'menor_melhor', decimals: 2, maximum: '8760', unit: 'h', weight: '25' },
    { indicatorCode: 'DEMO-V1-04', name: 'Verificações realizadas', meta: '12', direction: 'maior_melhor', decimals: 0, maximum: '999999', unit: null, weight: '20' }] }] };

describe('RuleCatalogPage', () => {
  it('shows the rule in use as locked, read only, with the calculation of each indicator', async () => {
    const { client, calls } = rpcClient(() => catalog);
    render(<RuleCatalogPage client={client} group={group} />);
    expect(await screen.findByText('Em uso · bloqueada')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'DEMO-v1' })).toBeTruthy();
    // The model-3 shell already renders the page heading; a second h2 would repeat it.
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByText(/Vigência a partir de 01\/09\/2026/)).toBeTruthy();
    expect(screen.getByText(/regra fictícia acadêmica/)).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Indicadores da regra DEMO-v1' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5);
    expect(within(rows[1]).getByText('DEMO-V1-01')).toBeTruthy();
    expect(within(rows[1]).getByText('≥ 95 %')).toBeTruthy();
    expect(within(rows[1]).getByText('min(valor ÷ meta; 1) × peso')).toBeTruthy();
    expect(within(rows[3]).getByText('≤ 48 h')).toBeTruthy();
    expect(within(rows[3]).getByText('min(meta ÷ valor; 1) × peso')).toBeTruthy();
    expect(screen.getByText('Pesos somam 100 · Arredondamento: centésimos, metade para cima')).toBeTruthy();
    expect(rows[1].querySelector('td')?.getAttribute('data-label')).toBe('Indicador');
    expect(screen.getByText(/ausências valem zero/i)).toBeTruthy();
    expect(calls).toEqual([{ name: 'get_rule_catalog', body: { p_contexto: { vinculoId: 'link', competenciaId: 'month', indicadorId: 'indicator' } } }]);
  });

  it('has no control to edit, create or save a rule', async () => {
    const { client } = rpcClient(() => catalog);
    render(<RuleCatalogPage client={client} group={group} />);
    await screen.findByText('Em uso · bloqueada');
    expect(screen.queryByRole('button', { name: /editar|criar|salvar/i })).toBeNull();
    expect(screen.getByText('Em uso · bloqueada').className).toContain('t-ok');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('does not claim a lock for a version that is not in use and describes redistribution', async () => {
    const { client } = rpcClient(() => ({ ruleSets: [{ ...catalog.ruleSets[0], inUse: false, mode: 'redistribuir' as const }] }));
    render(<RuleCatalogPage client={client} group={group} />);
    expect(await screen.findByText('Disponível · ainda não usada')).toBeTruthy();
    expect(screen.queryByText('Em uso · bloqueada')).toBeNull();
    expect(screen.getByText(/redistribuídos/i)).toBeTruthy();
  });

  it('reports a failed read and can retry', async () => {
    const { client, calls } = rpcClient(() => ({ code: '42501', message: 'access_denied' }), 403);
    render(<RuleCatalogPage client={client} group={group} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Não foi possível confirmar o catálogo de regras.');
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar catálogo' }));
    await screen.findByRole('alert');
    expect(calls).toHaveLength(2);
  });
});
