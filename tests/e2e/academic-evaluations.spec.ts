import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { openContextPicker } from './academicFlowSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { saveDraft, listPositions } from '../../src/features/submission/positionApi';
import { submitPosition } from '../../src/features/submission/submitApi';
import { startReview, reviewPosition } from '../../src/features/review/reviewApi';
import { authorizeCorrection, correctPosition, decideUnavailability } from '../../src/features/review/correctionApi';
import { loadCycleChecklist, transitionCycle, publishCycleDemo } from '../../src/features/cycle/cycleApi';
import { loadEvaluations } from '../../src/features/evaluation/evaluationApi';
import { loadDashboard } from '../../src/features/workspace/academicDashboardApi';
import type { Role } from '../../src/features/pilot/types';
test.use({ trace: 'off' });
test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires owned academic fixture');
async function signIn(role: Parameters<typeof academicCredential>[0]) {
    const client = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    expect((await client.auth.signInWithPassword(academicCredential(role))).error).toBeNull();
    return client;
}
async function contexts(client: SupabaseClient, role: Role) {
    return (await loadAuthorizedContexts(client)).filter(c => c.role === role && c.competenciaCodigo === 'ACADEMIC-2026-10');
}
async function browserLogin(page: Page, role: Role) {
    await page.goto('/');
    await page.getByLabel('E-mail').fill(academicCredential(role).email);
    await page.getByLabel('Senha').fill(academicCredential(role).password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const picker = await openContextPicker(page);
    const option = picker.locator('option').filter({
        hasText: `${role} · ACADEMIC-NORTE${role === 'gestor_unidade' ? '-1' : ''} · ACADEMIC-2026-10`,
    });
    await picker.selectOption((await option.getAttribute('value'))!);
}
test('scoped manager snapshots, nonfinancial leadership aggregates and safe audit stay server-authorized', async ({ page }) => {
    const clients: SupabaseClient[] = [];
    const cam = await signIn('cam'), manager = await signIn('gestor_unidade'), district = await signIn('gestor_distrital'), leader = await signIn('lideranca'), admin = await signIn('administrador');
    clients.push(cam, manager, district, leader, admin);
    try {
        const cc = toCommandContext((await contexts(cam, 'cam'))[0]), mc = toCommandContext((await contexts(manager, 'gestor_unidade'))[0]), dc = toCommandContext((await contexts(district, 'gestor_distrital'))[0]), lc = toCommandContext((await contexts(leader, 'lideranca'))[0]), ac = toCommandContext((await contexts(admin, 'administrador'))[0]);
        expect((await loadEvaluations(manager, mc, 'own', { page: 1, pageSize: 25 })).total).toBe(0);
        for (const side of [0, 1]) {
            const technical = await signIn(side ? 'southTechnical' : 'area_tecnica'), reviewer = await signIn(side ? 'southReviewer' : 'revisor_tecnico');
            clients.push(technical, reviewer);
            const rc = await contexts(reviewer, 'revisor_tecnico');
            for (const tc of await contexts(technical, 'area_tecnica')) {
                const command = toCommandContext(tc), position = (await listPositions(technical, command, { page: 1, pageSize: 25 })).items[0];
                const unavailable = tc.escopoCodigo === 'ACADEMIC-SUL-2';
                const ownDistrict = tc.escopoCodigo === 'ACADEMIC-NORTE' || tc.escopoCodigo === 'ACADEMIC-SUL';
                const input = { estadoDado: unavailable ? 'indisponivel' as const : 'valor' as const, valor: unavailable ? null : ownDistrict ? '100' : '10', fonte: 'Synthetic T10 source', periodoFonte: '2026-10-01', motivo: unavailable ? 'Synthetic missing source' : '' };
                let r = await saveDraft(technical, command, position.id, position.version, input, crypto.randomUUID());
                r = await submitPosition(technical, command, position.id, r.version, crypto.randomUUID());
                if (tc.escopoCodigo === 'ACADEMIC-NORTE-1')
                    expect((await loadEvaluations(manager, mc, 'own', { page: 1, pageSize: 25 })).total).toBe(0);
                const reviewContext = toCommandContext(rc.find(c => c.escopoId === tc.escopoId)!);
                r = await startReview(reviewer, reviewContext, position.id, r.version, crypto.randomUUID());
                r = await reviewPosition(reviewer, reviewContext, position.id, r.version, 'accept', 'Private independent reason', crypto.randomUUID());
                const exactCam = toCommandContext((await contexts(cam, 'cam')).find(c => c.escopoId === tc.escopoId)!);
                if (tc.escopoCodigo === 'ACADEMIC-NORTE-1') {
                    expect((await loadEvaluations(manager, mc, 'own', { page: 1, pageSize: 25 })).items[0]).toMatchObject({ resultValue: '8', publication: 'preliminar' });
                    r = await authorizeCorrection(cam, exactCam, position.id, r.version, 'Private rectification reason', crypto.randomUUID());
                    expect((await loadEvaluations(manager, mc, 'own', { page: 1, pageSize: 25 })).total).toBe(0);
                    r = await correctPosition(technical, command, position.id, r.version, { ...input, valor: '12' }, crypto.randomUUID());
                    r = await startReview(reviewer, reviewContext, position.id, r.version, crypto.randomUUID());
                    r = await reviewPosition(reviewer, reviewContext, position.id, r.version, 'accept', 'Private new revision reason', crypto.randomUUID());
                }
                if (unavailable)
                    await decideUnavailability(cam, exactCam, position.id, r.version, 'DEMO-UNAVAILABLE-T10', 'Private CAM reason', crypto.randomUUID());
            }
        }
        expect((await loadEvaluations(district, dc, 'own', { page: 1, pageSize: 25 })).items[0].resultValue).toBe('80');
        expect((await loadEvaluations(district, dc, 'territory', { page: 1, pageSize: 25 })).items.map(r => r.escopoCodigo)).toEqual(['ACADEMIC-NORTE-1', 'ACADEMIC-NORTE-2']);
        expect((await loadEvaluations(manager, mc, 'own', { page: 1, pageSize: 25, search: 'SUL' })).total).toBe(0);
        for (const filters of [{ page: 0, pageSize: 25 }, { page: 1, pageSize: 101 }])
            expect((await manager.rpc('get_my_evaluations', { p_contexto: mc, p_view: 'own', p_filters: filters })).error?.code).toBe('22023');
        expect((await manager.rpc('get_my_evaluations', { p_contexto: mc, p_view: 'territory', p_filters: {} })).error?.code).toBe('42501');
        const dashboard = await loadDashboard(cam, cc);
        expect(dashboard.expected).toBe(6);
        for (const card of dashboard.cards)
            if (card.filter)
                expect((await listPositions(cam, cc, card.filter)).total).toBe(card.count);
        expect(await loadDashboard(leader, lc)).toMatchObject({ expected: 2, received: 2, reviewed: 2, cards: [] });
        expect((await leader.rpc('get_leadership_aggregates', { p_contexto: lc })).data).toEqual([]);
        let check = await loadCycleChecklist(cam, cc);
        await transitionCycle(cam, cc, check.version, 'consolidate', '', '', crypto.randomUUID());
        check = await loadCycleChecklist(cam, cc);
        await transitionCycle(cam, cc, check.version, 'close', '', 'DEMO-DECISAO-T10', crypto.randomUUID());
        check = await loadCycleChecklist(cam, cc);
        await publishCycleDemo(cam, cc, check.snapshotId!, 'DEMO-PUBLICACAO-T10', crypto.randomUUID());
        const aggregate = (await leader.rpc('get_leadership_aggregates', { p_contexto: lc })).data;
        expect(aggregate).toEqual([{ competencia: 'ACADEMIC-2026-10', distritoCodigo: 'ACADEMIC-NORTE', unidadeMedida: 'pontos sintéticos', publishedUnits: 2, calculableUnits: 2, resultSum: '17.6' }]);
        const evaluation = (await manager.rpc('get_my_evaluations', { p_contexto: mc, p_view: 'own', p_filters: {} })).data.items[0];
        expect(evaluation.publication).toBe('publicada_demo');
        for (const key of ['actorId', 'authorId', 'source', 'reason', 'decisions'])
            expect(evaluation).not.toHaveProperty(key);
        const audit = (await manager.rpc('get_scoped_audit', { p_contexto: mc, p_filters: {} })).data;
        expect(audit.items.length).toBeGreaterThan(0);
        for (const event of audit.items) {
            expect(event.reason).toBeNull();
            expect(event).not.toHaveProperty('actorId');
        }
        expect((await admin.rpc('get_scoped_audit', { p_contexto: ac, p_filters: {} })).data.items).toEqual([]);
        expect((await admin.rpc('get_dashboard', { p_contexto: ac })).error?.code).toBe('42501');
        expect((await leader.rpc('get_scoped_audit', { p_contexto: lc, p_filters: {} })).error?.code).toBe('42501');
        expect((await manager.from('entradas').select('id').eq('posicao_id', evaluation.id)).data).toEqual([]);
        expect((await leader.from('itens_fechamento').select('*')).error?.code).toBe('42501');
        await browserLogin(page, 'gestor_unidade');
        await expect(page.getByText('12 × 0.8 = 9.6')).toBeVisible();
        await expect(page.getByText(/Publicada na demonstração · Regra v1/)).toBeVisible();
        await page.reload();
        const picker = await openContextPicker(page);
        await picker.selectOption((await picker.locator('option').filter({ hasText: 'gestor_unidade · ACADEMIC-NORTE-1 · ACADEMIC-2026-10' }).getAttribute('value'))!);
        await expect(page.getByText('12 × 0.8 = 9.6')).toBeVisible();
        await page.getByRole('button', { name: 'Histórico', exact: true }).click();
        await page.getByLabel('Buscar ação ou alvo').fill('ACADEMIC-NORTE-1');
        await page.getByRole('button', { name: 'Filtrar histórico' }).click();
        await expect(page.getByText('Eventos no filtro: 2')).toBeVisible();
        await page.getByLabel('Buscar ação ou alvo').fill('ACADEMIC-SUL');
        await page.getByRole('button', { name: 'Filtrar histórico' }).click();
        await expect(page.getByText('Nenhum evento autorizado neste filtro.')).toBeVisible();
        await page.getByRole('button', { name: 'Sair', exact: true }).click();
        await browserLogin(page, 'gestor_distrital');
        await expect(page.getByText('100 × 0.8 = 80')).toBeVisible();
        await page.getByRole('button', { name: 'Unidades do território' }).click();
        await expect(page.getByText('12 × 0.8 = 9.6')).toBeVisible();
        await expect(page.getByText('100 × 0.8 = 80')).toHaveCount(0);
        await page.getByRole('button', { name: 'Sair', exact: true }).click();
        await browserLogin(page, 'lideranca');
        await expect(page.getByText(/Soma de controle: 17.6/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Histórico', exact: true })).toHaveCount(0);
        await expect(page.getByText('100 × 0.8 = 80')).toHaveCount(0);
        // Task 1: for lideranca, Painel is the aggregates page itself (no dashboard capability), so it is the page already open.
        await page.getByRole('button', { name: 'Painel', exact: true }).click();
        await expect(page.getByText(/Soma de controle: 17.6/)).toBeVisible();
        await expect(page.getByText(/Universo:/)).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Posições do cartão' })).toHaveCount(0);
        await page.getByRole('button', { name: 'Sair', exact: true }).click();
        await browserLogin(page, 'administrador');
        await page.getByRole('button', { name: 'Auditoria', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Auditoria administrativa' })).toBeVisible();
        await expect(page.getByText('Nenhum evento autorizado neste filtro.')).toBeVisible();
        // Task 1 gave the administrator a Painel destination (metadata only); the original intent, no operational dashboard, is kept.
        await page.getByRole('button', { name: 'Painel', exact: true }).click();
        await expect(page.getByText(/Universo:/)).toHaveCount(0);
        await page.getByRole('button', { name: 'Sair', exact: true }).click();
        await browserLogin(page, 'cam');
        await page.getByRole('button', { name: 'Painel', exact: true }).click();
        await page.getByRole('button', { name: 'validada: 6 de 6' }).click();
        await expect(page.getByText('Posições no filtro: 6')).toBeVisible();
        await expect(page.getByRole('region', { name: 'Posições do cartão' }).getByRole('listitem')).toHaveCount(6);
    }
    finally {
        for (const client of clients)
            await client.auth.signOut();
    }
});
