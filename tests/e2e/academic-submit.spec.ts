import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { academicCredential } from './e2eSupport';
import { openAcademicPage } from './academicFlowSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { listPositions, loadPositionDetail, saveDraft } from '../../src/features/submission/positionApi';
import { submitPosition } from '../../src/features/submission/submitApi';
import { validateOwnedTarget, type OwnedTarget } from '../../scripts/verification/runtime';
import type { AuthorizedContext } from '../../src/features/pilot/types';
test.use({ trace: 'off' });
test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires isolated academic fixture');
const input = (value: string) => ({ estadoDado: 'valor' as const, valor: value, fonte: 'Synthetic T06', periodoFonte: '2026-10-01', motivo: '' });
async function login(page: Page, profile: 'area_tecnica' | 'southTechnical', scope: string, month = 'ACADEMIC-2026-10') {
    await page.goto('/');
    await page.getByLabel('E-mail').fill(academicCredential(profile).email);
    await page.getByLabel('Senha').fill(academicCredential(profile).password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const picker = page.getByLabel('Contexto autorizado');
    const option = picker.locator('option').filter({ hasText: `area_tecnica · ${scope} · ${month}` });
    await expect(option).toHaveCount(1);
    const key = (await option.getAttribute('value'))!;
    await picker.selectOption(key);
    await openAcademicPage(page, 'Preenchimento');
    return key;
}
async function saveInUi(page: Page, scope: string, value: string) {
    await page.getByRole('button', { name: new RegExp(`${scope} · ausente`) }).click();
    await page.getByLabel('Valor', { exact: true }).fill(value);
    await page.getByLabel('Fonte', { exact: true }).fill('Synthetic T06');
    await page.getByLabel('Período da fonte').fill('2026-10-01');
    await page.getByRole('button', { name: 'Salvar rascunho' }).click();
    await expect(page.getByText('Rascunho salvo. Ainda não enviado.')).toBeVisible();
}
test('real UI restores a committed response-loss retry after reload with identical operation/version', async ({ page }) => {
    const key = await login(page, 'southTechnical', 'ACADEMIC-SUL-1');
    await saveInUi(page, 'ACADEMIC-SUL-1', '10');
    const payloads: unknown[] = [];
    let lost = true;
    await page.route('**/rest/v1/rpc/submit_position', async (route) => {
        payloads.push(route.request().postDataJSON());
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        if (lost) {
            lost = false;
            await route.abort('failed');
        }
        else
            await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.reload();
    await page.getByLabel('Contexto autorizado').selectOption(key);
    await page.getByRole('button', { name: /ACADEMIC-SUL-1 · enviada/ }).click();
    await page.getByRole('button', { name: 'Repetir envio pendente' }).click();
    await expect(page.getByText('Envio confirmado. Dados fixados para revisão.')).toBeVisible();
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[0]).toMatchObject({ p_expected_version: 2 });
    await expect(page.getByText('Resultado sintético: 8')).toBeVisible();
    expect(eventCount([(payloads[0] as {
            p_position_id: string;
        }).p_position_id])).toBe(2);
    await expect(page.getByLabel('Valor', { exact: true })).toBeDisabled();
});
test('late submission never confirms in another context; the tiny exact result is persisted', async ({ page }) => {
    await login(page, 'southTechnical', 'ACADEMIC-SUL-2');
    await saveInUi(page, 'ACADEMIC-SUL-2', '0.0001');
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let committed!: () => void;
    const complete = new Promise<void>(resolve => { committed = resolve; });
    await page.route('**/rest/v1/rpc/submit_position', async (route) => { const response = await route.fetch(); expect(response.status()).toBe(200); committed(); await wait; await route.fulfill({ response }); });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await complete;
    const other = await page.getByLabel('Contexto autorizado').locator('option').filter({ hasText: 'area_tecnica · ACADEMIC-SUL-2 · ACADEMIC-2026-09' }).getAttribute('value');
    page.once('dialog', dialog => dialog.accept());
    await page.getByLabel('Contexto autorizado').selectOption(other!);
    release();
    await expect(page.getByText(/Perfil area_tecnica · ACADEMIC-SUL-2 · ACADEMIC-2026-09/)).toBeVisible();
    await expect(page.getByText(/Envio confirmado/)).toHaveCount(0);
    const client = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword(academicCredential('southTechnical'))).error).toBeNull();
    const context = (await loadAuthorizedContexts(client)).find(c => c.role === 'area_tecnica' && c.escopoCodigo === 'ACADEMIC-SUL-2' && c.competenciaCodigo === 'ACADEMIC-2026-10')!;
    const position = (await listPositions(client, toCommandContext(context), { page: 1, pageSize: 25 })).items[0];
    const detail = await loadPositionDetail(client, toCommandContext(context), position.id);
    expect(detail.memories).toEqual([{ revisionId: position.revisionId, ruleVersion: 1, factor: '0.8', inputValue: '0.0001', resultValue: '0.00008' }]);
    await client.auth.signOut();
});
test('logout during committed submission cannot confirm an old actor session', async ({ page }) => {
    await login(page, 'area_tecnica', 'ACADEMIC-NORTE-2', 'ACADEMIC-2026-09');
    await saveInUi(page, 'ACADEMIC-NORTE-2', '10');
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    let committed!: () => void;
    const complete = new Promise<void>(resolve => { committed = resolve; });
    await page.route('**/rest/v1/rpc/submit_position', async (route) => { const response = await route.fetch(); committed(); await wait; await route.fulfill({ response }); });
    await page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await complete;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Sair', exact: true }).click();
    await expect(page.getByLabel('E-mail')).toBeVisible();
    release();
    await expect(page.getByText(/Envio confirmado/)).toHaveCount(0);
});
test('real RPC boundaries calculate zero/extreme and keep unavailable nonnumeric', async () => {
    const client = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword(academicCredential('southTechnical'))).error).toBeNull();
    const contexts = await loadAuthorizedContexts(client);
    for (const [scope, value, want] of [['ACADEMIC-SUL-1', '0', '0'], ['ACADEMIC-SUL-2', '99999999.9999', '79999999.99992'], ['ACADEMIC-SUL', null, null]] as const) {
        const context = contexts.find(c => c.role === 'area_tecnica' && c.escopoCodigo === scope && c.competenciaCodigo === 'ACADEMIC-2026-09')!;
        const command = toCommandContext(context);
        const position = (await listPositions(client, command, { page: 1, pageSize: 25 })).items[0];
        const receipt = await saveDraft(client, command, position.id, position.version, value === null ? { ...input('0'), estadoDado: 'indisponivel', valor: null, motivo: 'Synthetic source unavailable' } : input(value), crypto.randomUUID());
        const operation = crypto.randomUUID();
        const [sent, concurrent] = await Promise.all([submitPosition(client, command, position.id, receipt.version, operation), submitPosition(client, command, position.id, receipt.version, operation)]);
        expect(concurrent).toEqual(sent);
        expect(sent.resultValue).toBe(want);
        expect(await submitPosition(client, command, position.id, receipt.version, operation)).toEqual(sent);
        const detail = await loadPositionDetail(client, command, position.id);
        expect(detail.memories).toHaveLength(value === null ? 0 : 1);
        expect(detail.position.estadoDado).toBe(value === null ? 'indisponivel' : 'valor');
    }
    await client.auth.signOut();
});
function eventCount(positionIds: string[]): number {
    const target = JSON.parse(process.env.VERIFICATION_OWNED_TARGET!) as OwnedTarget;
    validateOwnedTarget(target);
    if (positionIds.some(id => !/^[0-9a-f-]{36}$/i.test(id)))
        throw new Error('Invalid synthetic position');
    const query = `select count(*) from public.eventos_auditoria where recurso_id in (${positionIds.map(id => `'${id}'::uuid`).join(',')})`;
    return Number(execFileSync('docker', ['exec', `supabase_db_${target.projectId}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', query], { encoding: 'utf8' }).trim());
}
test('same actor/key across authorized competences produces one mutation/event and cross-command mismatch', async () => {
    const client = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    expect((await client.auth.signInWithPassword(academicCredential('area_tecnica'))).error).toBeNull();
    const contexts = (await loadAuthorizedContexts(client)).filter(c => c.escopoCodigo === 'ACADEMIC-NORTE' && c.role === 'area_tecnica');
    expect(contexts).toHaveLength(2);
    const positions = await Promise.all(contexts.map(async (context) => (await listPositions(client, toCommandContext(context), { page: 1, pageSize: 25 })).items[0]));
    const operation = crypto.randomUUID();
    const outcomes = await Promise.allSettled(contexts.map((context, i) => saveDraft(client, toCommandContext(context), positions[i].id, positions[i].version, input('10'), operation)));
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
    const failed = outcomes.find(o => o.status === 'rejected') as PromiseRejectedResult;
    expect(failed.reason).toMatchObject({ code: 'operation_payload_mismatch' });
    const details = await Promise.all(contexts.map((context, i) => loadPositionDetail(client, toCommandContext(context), positions[i].id)));
    expect(details.map(d => d.revisions.length).sort()).toEqual([0, 1]);
    expect(details.map(d => d.position.version).sort()).toEqual([1, 2]);
    expect(eventCount(positions.map(p => p.id))).toBe(1);
    const i = outcomes.findIndex(o => o.status === 'fulfilled');
    const context: AuthorizedContext = contexts[i];
    await expect(submitPosition(client, toCommandContext(context), positions[i].id, 2, operation)).rejects.toMatchObject({ code: 'operation_payload_mismatch' });
    expect(eventCount(positions.map(p => p.id))).toBe(1);
    await client.auth.signOut();
});
