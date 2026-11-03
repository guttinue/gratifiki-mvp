import { createClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { academicCredential } from './e2eSupport';
import { loadAuthorizedContexts, toCommandContext } from '../../src/features/context/contextApi';
import { listPositions, loadPositionDetail } from '../../src/features/submission/positionApi';
import { academicId } from '../../scripts/bootstrap/academicFixtures';
import type { Role } from '../../src/features/pilot/types';
test.use({ trace: 'off' });
test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires the explicitly selected academic fixture');
const roles: Role[] = ['area_tecnica', 'revisor_tecnico', 'cam', 'gestor_unidade', 'gestor_distrital', 'administrador', 'lideranca'];
for (const role of roles)
    test(`real ${role} login selects only its authorized academic context`, async ({ page }) => {
        const credentials = academicCredential(role);
        await page.goto('/');
        await page.getByLabel('E-mail').fill(credentials.email);
        await page.getByLabel('Senha').fill(credentials.password);
        await page.getByRole('button', { name: 'Entrar', exact: true }).click();
        const picker = page.getByLabel('Contexto autorizado');
        await expect(picker).toBeVisible();
        const options = await picker.locator('option').evaluateAll(options => options.map(o => ({ text: o.textContent ?? '', value: o.getAttribute('value') ?? '' })).filter(o => o.value));
        expect(options.every(o => o.text.startsWith(`${role} ·`))).toBeTruthy();
        const selected = options.find(o => o.text.includes('ACADEMIC-2026-10'));
        expect(selected).toBeDefined();
        await picker.selectOption(selected!.value);
        await expect(page.getByRole('heading', { name: 'Contexto acadêmico autorizado' })).toBeVisible();
        await expect(page.getByText(new RegExp(`Perfil ${role} ·`))).toBeVisible();
        const client = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
        expect((await client.auth.signInWithPassword(credentials)).error).toBeNull();
        const contexts = await loadAuthorizedContexts(client);
        if (role === 'administrador')
            expect(new Set(contexts.map(c => c.competenciaCodigo))).toEqual(new Set(['ACADEMIC-2026-09', 'ACADEMIC-2026-10']));
        // The picker value is the group key (role:competenciaId:escopoId).
        const context = contexts.find(c => `${c.role}:${c.competenciaId}:${c.escopoId}` === selected!.value)!;
        expect(context.actorId).toBe((await client.auth.getUser()).data.user?.id);
        if (['area_tecnica', 'revisor_tecnico', 'cam'].includes(role)) {
            const result = await listPositions(client, toCommandContext(context), { page: 1, pageSize: 25 });
            expect(result.total).toBe(role === 'cam' ? 6 : 1);
            expect(result.items.every(p => p.status === 'ausente' && p.version === 1 && p.inputValue === null && p.resultValue === null)).toBeTruthy();
            expect((await loadPositionDetail(client, toCommandContext(context), result.items[0].id)).revisions).toEqual([]);
        }
        else {
            await expect(listPositions(client, toCommandContext(context), { page: 1, pageSize: 25 })).rejects.toMatchObject({ code: '42501' });
            await expect(loadPositionDetail(client, toCommandContext(context), academicId(110))).rejects.toMatchObject({ code: '42501' });
        }
        await client.auth.signOut();
        await page.getByRole('button', { name: 'Sair', exact: true }).click();
        await expect(page.getByLabel('E-mail')).toBeVisible();
    });
test('restricted technical, reviewer, partial CAM and dual-role contexts never inherit other targets', async () => {
    for (const profile of ['area_tecnica', 'revisor_tecnico', 'partialCam', 'southTechnical'] as const) {
        const client = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
        expect((await client.auth.signInWithPassword(academicCredential(profile))).error).toBeNull();
        const contexts = (await loadAuthorizedContexts(client)).filter(c => c.competenciaCodigo === 'ACADEMIC-2026-10');
        expect(contexts.length, `${profile}: October scope evidence must not be vacuous`).toBeGreaterThan(0);
        if (profile === 'southTechnical')
            expect(new Set(contexts.map(c => c.role))).toEqual(new Set(['cam', 'area_tecnica']));
        for (const context of contexts) {
            const result = await listPositions(client, toCommandContext(context), { page: 1, pageSize: 25 });
            expect(result.total).toBe(1);
            const outside = result.items[0].id === academicId(110) ? academicId(115) : academicId(110);
            await expect(loadPositionDetail(client, toCommandContext(context), outside)).rejects.toMatchObject({ code: '42501' });
            if (profile === 'area_tecnica' || profile === 'revisor_tecnico')
                expect(result.items.every(p => p.escopoCodigo.includes('NORTE'))).toBeTruthy();
            if (profile === 'partialCam')
                expect(result.items[0].escopoTipo).toBe('distrito');
        }
        await client.auth.signOut();
    }
});
