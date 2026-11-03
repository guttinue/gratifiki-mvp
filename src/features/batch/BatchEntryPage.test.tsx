import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupContexts } from '../context/contextGroups';
import type { AuthorizedContext } from '../pilot/types';
import { NavigationSafety } from '../workspace/NavigationSafety';
import { BatchEntryPage } from './BatchEntryPage';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState({}, '', '/'); });
beforeEach(() => { window.history.replaceState({}, '', '/#academico/preenchimento'); });

// Four indicator links of one unit (Alfa), October of the V3 set.
const codes = ['DEMO-V1-01', 'DEMO-V1-02', 'DEMO-V1-03', 'DEMO-V1-04'];
const contexts: AuthorizedContext[] = codes.map((_code, i) => ({ key: `c${i + 1}`, actorId: 'actor', role: 'area_tecnica', vinculoId: `link-${i + 1}`,
  competenciaId: 'month', indicadorId: `indicator-${i + 1}`, escopoId: 'alfa', escopoCodigo: 'ACADEMIC-NORTE-1', competenciaCodigo: 'ACADEMIC-V3-2026-10',
  mode: 'academic', modelo: 3, competenciaEstado: 'aberta' }));
const group = groupContexts(contexts)[0];
const summary = (n: number, status: string, extra: object = {}) => ({ id: `position-${n}`, escopoId: 'alfa', escopoCodigo: 'ACADEMIC-NORTE-1', escopoTipo: 'unidade',
  aplicavel: true, status, estadoDado: null, version: 1, revisionId: null, inputValue: null, resultValue: null, ...extra });
const base = { direction: 'maior_melhor', decimals: 2, max: '100', unit: '%', estadoDado: null, valor: null, fonte: null, motivo: null, returnReason: null, revisionNumber: null };
// pgTAP 23 fixture: 01 draft with 90, 02 sent, 03 returned, 04 accepted.
const items = [
  { ...base, positionId: 'position-1', indicatorCode: codes[0], name: 'Registros conferidos', meta: '95', weight: '30', status: 'rascunho', version: 2, estadoDado: 'valor', valor: '90', fonte: 'Painel sintético', revisionNumber: 1 },
  { ...base, positionId: 'position-2', indicatorCode: codes[1], name: 'Rotinas concluídas', meta: '20', weight: '25', decimals: 0, max: '1000', unit: null, status: 'enviada', version: 3, estadoDado: 'valor', valor: '20', fonte: 'Relatório', revisionNumber: 1 },
  { ...base, positionId: 'position-3', indicatorCode: codes[2], name: 'Tempo de resposta', meta: '48', weight: '25', direction: 'menor_melhor', max: '8760', unit: 'h', status: 'devolvida', version: 5, estadoDado: 'valor', valor: '96', fonte: 'Sistema de chamados', returnReason: 'Confirme o mês de outubro.', revisionNumber: 1 },
  { ...base, positionId: 'position-4', indicatorCode: codes[3], name: 'Verificações realizadas', meta: '12', weight: '20', decimals: 0, max: '1000', unit: null, status: 'validada', version: 5, estadoDado: 'valor', valor: '12', fonte: 'Relatório', revisionNumber: 2 },
];
const rowStatus = ['rascunho', 'enviada', 'devolvida', 'validada'];
const receipt = (n: number, version: number, resultValue: string | null) => ({ resourceId: `position-${n}`, version, revisionId: `rev-${n}`, status: 'enviada', resultValue });

// What the tests read from an RPC body (a loose shape; the server contracts are in batchApi.test.ts).
type Body = { p_contexto: { indicadorId: string; vinculoId: string }; p_contextos: { indicadorId: string }[]; p_itens: { positionId: string; input: unknown }[];
  p_unidade_id: string; p_operation_id: string };
type Call = { name: string; body: Body };
function rpc(handler: (call: Call) => Response | undefined = () => undefined) {
  const calls: Call[] = [];
  const client = createClient('http://localhost:54321', 'key', { auth: { persistSession: false, storageKey: crypto.randomUUID() }, global: { fetch: async (url, init) => {
    const call = { name: String(url).split('/rpc/')[1], body: JSON.parse(String(init?.body ?? '{}')) as Body };
    calls.push(call);
    const custom = handler(call);
    if (custom) return custom;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (call.name === 'get_operational_positions') {
      const n = Number(String(call.body.p_contexto.indicadorId).replace('indicator-', ''));
      return json({ items: [summary(n, rowStatus[n - 1])], total: 1, page: 1, pageSize: 100 });
    }
    if (call.name === 'get_unit_batch') return json({ unitId: 'alfa', unitCode: 'ACADEMIC-NORTE-1', items });
    if (call.name === 'submit_unit_batch') return json({ items: call.body.p_itens.map((item) => receipt(Number(item.positionId.replace('position-', '')), 9, '28.42')) });
    if (call.name === 'save_position_draft') return json({ resourceId: 'position-1', version: 3, revisionId: 'rev-1', status: 'rascunho', resultValue: null });
    return json({});
  } } });
  return { client, calls };
}
const card = (code: string) => screen.getByRole('region', { name: new RegExp(code) });
async function open() {
  const view = rpc();
  render(<BatchEntryPage client={view.client} group={group} />);
  await screen.findByText(/DEMO-V1-01/);
  return view;
}

describe('BatchEntryPage', () => {
  it('lists one card per indicator of the unit, counts 1 ready (01 = 90) and enables the send button', async () => {
    const { calls } = await open();
    expect(screen.getAllByRole('region', { name: /DEMO-V1/ }).length).toBe(4);
    expect(screen.getByText('1 pronto para envio')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Enviar 1 item' }) as HTMLButtonElement).disabled).toBe(false);
    const batchCall = calls.find(c => c.name === 'get_unit_batch')!;
    expect(batchCall.body.p_unidade_id).toBe('alfa');
    expect(batchCall.body.p_contextos.map((c) => c.indicadorId)).toEqual(['indicator-1', 'indicator-2', 'indicator-3', 'indicator-4']);
  });

  it('shows the fixed copy of the three situations as a radio group and the unit selector', async () => {
    await open();
    const situation = within(card('DEMO-V1-01')).getByRole('radiogroup', { name: 'Situação do dado' });
    expect(within(situation).getAllByRole('radio').map(r => (r as HTMLInputElement).labels?.[0].textContent)).toEqual(['Tenho o valor', 'Não se aplica', 'Indisponível']);
    expect((within(situation).getByRole('radio', { name: 'Tenho o valor' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByLabelText('Unidade')).toBeTruthy();
  });

  it('shows the live points as a preview with the server rounding (88 → 27,79 and 90 → 28,42)', async () => {
    await open();
    const first = card('DEMO-V1-01');
    expect(within(first).getByText('28,42')).toBeTruthy();
    fireEvent.change(within(first).getByLabelText('Valor apurado'), { target: { value: '88' } });
    expect(within(first).getByText('27,79')).toBeTruthy();
    expect(within(first).getByText(/prévia/i)).toBeTruthy();
    expect(within(first).getByText('min(88 ÷ 95; 1) × 30')).toBeTruthy();
  });

  it.each([['0', '25,00'], ['60', '20,00'], ['52', '23,08']])('previews the descending indicator at %s as %s', async (value, points) => {
    await open();
    const third = card('DEMO-V1-03');
    fireEvent.change(within(third).getByLabelText('Valor apurado'), { target: { value } });
    expect(within(third).getByText(points)).toBeTruthy();
  });

  it('rejects 90,123 with the decimals message, ties it to the field and blocks the send', async () => {
    await open();
    const first = card('DEMO-V1-01');
    const input = within(first).getByLabelText('Valor apurado');
    fireEvent.change(input, { target: { value: '90,123' } });
    const message = within(first).getByText('Use no máximo 2 casas decimais.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(message.id);
    expect(screen.getByText('0 prontos para envio')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Enviar 0 itens' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(first).queryByText('prévia')).toBeNull();
  });

  it('blocks the send while any filled card has an error, even if another is ready', async () => {
    await open();
    fireEvent.change(within(card('DEMO-V1-03')).getByLabelText('O que você corrigiu?'), { target: { value: 'Usei outubro.' } });
    expect(screen.getByText('2 prontos para envio')).toBeTruthy();
    fireEvent.change(within(card('DEMO-V1-01')).getByLabelText('Valor apurado'), { target: { value: '100,5' } });
    expect(within(card('DEMO-V1-01')).getByText('O valor máximo é 100.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Enviar/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not count a returned item without the explanation, and shows the return reason', async () => {
    await open();
    const third = card('DEMO-V1-03');
    expect(within(third).getByText('Confirme o mês de outubro.')).toBeTruthy();
    expect(screen.getByText('1 pronto para envio')).toBeTruthy();
    fireEvent.change(within(third).getByLabelText('O que você corrigiu?'), { target: { value: '   ' } });
    expect(screen.getByText('1 pronto para envio')).toBeTruthy();
    fireEvent.change(within(third).getByLabelText('O que você corrigiu?'), { target: { value: 'Usei outubro.' } });
    expect(screen.getByText('2 prontos para envio')).toBeTruthy();
  });

  it('keeps sent and accepted cards read-only and out of the count', async () => {
    await open();
    const second = card('DEMO-V1-02');
    expect(within(second).queryByLabelText('Valor apurado')).toBeNull();
    expect(within(second).getByText('Aguardando conferência')).toBeTruthy();
    expect(within(card('DEMO-V1-04')).getByText('Aceita')).toBeTruthy();
  });

  it('does not count a non-applicable position of the unit as ready or sendable', async () => {
    const view = rpc(call => call.name === 'get_operational_positions' && call.body.p_contexto.indicadorId === 'indicator-1'
      ? new Response(JSON.stringify({ items: [summary(1, 'rascunho', { aplicavel: false })], total: 1, page: 1, pageSize: 100 }), { headers: { 'content-type': 'application/json' } }) : undefined);
    render(<BatchEntryPage client={view.client} group={group} />);
    await screen.findByText(/DEMO-V1-01/);
    expect(screen.getByText('0 prontos para envio')).toBeTruthy();
    expect(within(card('DEMO-V1-01')).queryByLabelText('Valor apurado')).toBeNull();
    expect(within(card('DEMO-V1-01')).getByText('Não se aplica a esta unidade neste mês.')).toBeTruthy();
  });

  it('requires a reason and a source for Indisponível and Não se aplica', async () => {
    await open();
    const first = card('DEMO-V1-01');
    fireEvent.click(within(first).getByRole('radio', { name: 'Não se aplica' }));
    expect(within(first).queryByLabelText('Valor apurado')).toBeNull();
    expect(screen.getByText('0 prontos para envio')).toBeTruthy();
    expect(within(first).getByText('Sem pontuação numérica. A CAM define o tratamento; não vira zero.')).toBeTruthy();
    fireEvent.change(within(first).getByLabelText('Por que este indicador não se aplica?'), { target: { value: 'Unidade sem este serviço.' } });
    expect(screen.getByText('1 pronto para envio')).toBeTruthy();
    fireEvent.click(within(first).getByRole('radio', { name: 'Indisponível' }));
    expect(within(first).getByLabelText('Por que o dado está indisponível?')).toBeTruthy();
  });

  it('sends the ready items under one operation with the explanation only in correction', async () => {
    const { client, calls } = rpc();
    render(<BatchEntryPage client={client} group={group} />);
    await screen.findByText(/DEMO-V1-01/);
    fireEvent.change(within(card('DEMO-V1-03')).getByLabelText('Valor apurado'), { target: { value: '40' } });
    fireEvent.change(within(card('DEMO-V1-03')).getByLabelText('O que você corrigiu?'), { target: { value: '  Usei outubro.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar 2 itens' }));
    expect(await screen.findByText('2 itens enviados para conferência.')).toBeTruthy();
    const submit = calls.find(c => c.name === 'submit_unit_batch')!;
    expect(typeof submit.body.p_operation_id).toBe('string');
    expect(submit.body.p_itens).toEqual([
      { contexto: { vinculoId: 'link-1', competenciaId: 'month', indicadorId: 'indicator-1' }, positionId: 'position-1', expectedVersion: 2,
        input: { estadoDado: 'valor', valor: '90', fonte: 'Painel sintético', periodoFonte: '2026-10-01', motivo: '' }, correction: null },
      { contexto: { vinculoId: 'link-3', competenciaId: 'month', indicadorId: 'indicator-3' }, positionId: 'position-3', expectedVersion: 5,
        input: { estadoDado: 'valor', valor: '40', fonte: 'Sistema de chamados', periodoFonte: '2026-10-01', motivo: '' }, correction: { explanation: 'Usei outubro.' } },
    ]);
    expect(JSON.stringify(submit.body.p_itens[1].input)).not.toContain('explanation');
    // The unit is read again after the send.
    await waitFor(() => expect(calls.filter(c => c.name === 'get_unit_batch').length).toBe(2));
  });

  it('on a server error for one item focuses and marks that card and keeps everything typed', async () => {
    const view = rpc(call => call.name === 'submit_unit_batch'
      ? new Response(JSON.stringify({ code: '22023', message: 'invalid_input', details: JSON.stringify({ positionId: 'position-3', code: 'invalid_input' }), hint: null }), { status: 400, headers: { 'content-type': 'application/json' } })
      : undefined);
    render(<BatchEntryPage client={view.client} group={group} />);
    await screen.findByText(/DEMO-V1-01/);
    fireEvent.change(within(card('DEMO-V1-01')).getByLabelText('Valor apurado'), { target: { value: '91' } });
    fireEvent.change(within(card('DEMO-V1-03')).getByLabelText('Valor apurado'), { target: { value: '40' } });
    fireEvent.change(within(card('DEMO-V1-03')).getByLabelText('O que você corrigiu?'), { target: { value: 'Usei outubro.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar 2 itens' }));
    const third = card('DEMO-V1-03');
    await waitFor(() => expect(document.activeElement).toBe(third));
    expect(third.getAttribute('data-invalid')).toBe('true');
    const alert = within(third).getByRole('alert');
    expect(third.getAttribute('aria-describedby')).toBe(alert.id);
    expect(card('DEMO-V1-01').getAttribute('data-invalid')).toBeNull();
    expect((within(card('DEMO-V1-01')).getByLabelText('Valor apurado') as HTMLInputElement).value).toBe('91');
    expect((within(third).getByLabelText('Valor apurado') as HTMLInputElement).value).toBe('40');
    expect((within(third).getByLabelText('O que você corrigiu?') as HTMLTextAreaElement).value).toBe('Usei outubro.');
    expect(screen.getByText('2 prontos para envio')).toBeTruthy();
  });

  it('on a version conflict without an item shows a general reload message and keeps what was typed', async () => {
    const view = rpc(call => call.name === 'submit_unit_batch'
      ? new Response(JSON.stringify({ code: '40001', message: 'version_conflict', details: null, hint: null }), { status: 409, headers: { 'content-type': 'application/json' } })
      : undefined);
    render(<BatchEntryPage client={view.client} group={group} />);
    await screen.findByText(/DEMO-V1-01/);
    fireEvent.change(within(card('DEMO-V1-01')).getByLabelText('Valor apurado'), { target: { value: '91' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar 1 item' }));
    const alert = await screen.findByText(/Os dados mudaram/);
    expect(alert.getAttribute('role')).toBe('alert');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    expect((within(card('DEMO-V1-01')).getByLabelText('Valor apurado') as HTMLInputElement).value).toBe('91');
    fireEvent.click(screen.getByRole('button', { name: 'Recarregar unidade' }));
    await waitFor(() => expect(view.calls.filter(c => c.name === 'get_unit_batch').length).toBe(2));
    expect((within(card('DEMO-V1-01')).getByLabelText('Valor apurado') as HTMLInputElement).value).toBe('91');
  });

  it('reuses the operation id when the same payload is retried after a lost response', async () => {
    let lost = true;
    const view = rpc(call => {
      if (call.name !== 'submit_unit_batch' || !lost) return undefined;
      lost = false;
      return new Response('boom', { status: 502 });
    });
    render(<BatchEntryPage client={view.client} group={group} />);
    await screen.findByText(/DEMO-V1-01/);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar 1 item' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar 1 item' }));
    await screen.findByText('1 item enviado para conferência.');
    const sent = view.calls.filter(c => c.name === 'submit_unit_batch');
    expect(sent).toHaveLength(2);
    expect(sent[1].body.p_operation_id).toBe(sent[0].body.p_operation_id);
  });

  it('saves a card as a draft through save_position_draft with its own context', async () => {
    const { client, calls } = rpc();
    render(<BatchEntryPage client={client} group={group} />);
    await screen.findByText(/DEMO-V1-01/);
    fireEvent.change(within(card('DEMO-V1-01')).getByLabelText('Valor apurado'), { target: { value: '91,5' } });
    fireEvent.click(within(card('DEMO-V1-01')).getByRole('button', { name: 'Salvar rascunho' }));
    expect(await within(card('DEMO-V1-01')).findByText('Rascunho salvo.')).toBeTruthy();
    const save = calls.find(c => c.name === 'save_position_draft')!;
    expect(save.body).toMatchObject({ p_position_id: 'position-1', p_expected_version: 2, p_contexto: { vinculoId: 'link-1', indicadorId: 'indicator-1' },
      p_input: { estadoDado: 'valor', valor: '91.5', fonte: 'Painel sintético', periodoFonte: '2026-10-01', motivo: '' } });
    expect(within(card('DEMO-V1-03')).queryByRole('button', { name: 'Salvar rascunho' })).toBeNull();
  });

  it('asks before leaving with unsaved edits and keeps them when the leave is cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const view = rpc();
    render(<NavigationSafety><BatchEntryPage client={view.client} group={group} /></NavigationSafety>);
    await screen.findByText(/DEMO-V1-01/);
    expect(window.dispatchEvent(new Event('academic:beforeleave', { cancelable: true }))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(within(card('DEMO-V1-01')).getByLabelText('Valor apurado'), { target: { value: '91' } });
    let allowed = true;
    act(() => { allowed = window.dispatchEvent(new Event('academic:beforeleave', { cancelable: true })); });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(allowed).toBe(false);
    expect((within(card('DEMO-V1-01')).getByLabelText('Valor apurado') as HTMLInputElement).value).toBe('91');
  });

  it('shows the competence as read-only when it is not open', async () => {
    const closed = groupContexts(contexts.map(c => ({ ...c, competenciaEstado: 'em_consolidacao' as const })))[0];
    const view = rpc();
    render(<BatchEntryPage client={view.client} group={closed} />);
    await screen.findByText(/DEMO-V1-01/);
    expect(screen.getByText(/somente consulta/i)).toBeTruthy();
    expect(screen.queryByLabelText('Valor apurado')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Enviar/ })).toBeNull();
  });

  it('lets the technician switch units and loads the batch of the chosen one', async () => {
    const view = rpc(call => call.name === 'get_operational_positions' && call.body.p_contexto.indicadorId === 'indicator-1'
      ? new Response(JSON.stringify({ items: [summary(1, 'rascunho'), { ...summary(5, 'ausente'), escopoId: 'beta', escopoCodigo: 'ACADEMIC-NORTE-2' }], total: 2, page: 1, pageSize: 100 }), { headers: { 'content-type': 'application/json' } }) : undefined);
    render(<BatchEntryPage client={view.client} group={group} />);
    await screen.findByText(/DEMO-V1-01/);
    const picker = screen.getByLabelText('Unidade') as HTMLSelectElement;
    expect(Array.from(picker.options).map(o => o.textContent)).toEqual(['ACADEMIC-NORTE-1', 'ACADEMIC-NORTE-2']);
    fireEvent.change(picker, { target: { value: 'beta' } });
    await waitFor(() => expect(view.calls.filter(c => c.name === 'get_unit_batch').at(-1)!.body.p_unidade_id).toBe('beta'));
    expect(view.calls.filter(c => c.name === 'get_unit_batch').at(-1)!.body.p_contextos.map((c) => c.indicadorId)).toEqual(['indicator-1']);
  });

  it('shows a load failure without inventing cards', async () => {
    const view = rpc(call => call.name === 'get_operational_positions' ? new Response('{}', { status: 500 }) : undefined);
    render(<BatchEntryPage client={view.client} group={group} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText(/DEMO-V1/)).toBeNull();
  });
});
