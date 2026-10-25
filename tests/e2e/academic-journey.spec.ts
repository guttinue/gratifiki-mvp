import { expect, test, type Page } from '@playwright/test';
import { chooseAcademicContext, loginAcademic, logoutAcademic } from './academicFlowSupport';

test.use({ trace: 'off' });
test.skip(!process.env.ACADEMIC_CAM_EMAIL, 'Requires owned disposable academic fixture');

async function fillAndSubmit(page: Page, scope: string) {
  await chooseAcademicContext(page, 'area_tecnica', scope);
  await page.getByRole('button', { name: `${scope} · ausente`, exact: true }).click();
  await page.getByLabel('Valor', { exact: true }).fill('10');
  await page.getByLabel('Fonte', { exact: true }).fill('T14 fonte exclusivamente sintética');
  await page.getByLabel('Período da fonte', { exact: true }).fill('2026-10-01');
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).click();
  await expect(page.getByText('Rascunho salvo. Ainda não enviado.')).toBeVisible();
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText('Envio confirmado. Dados fixados para revisão.')).toBeVisible();
}

async function review(page: Page, scope: string, decision: 'accept' | 'return') {
  await chooseAcademicContext(page, 'revisor_tecnico', scope);
  await page.getByRole('button', { name: `${scope} · enviada`, exact: true }).click();
  await page.getByRole('button', { name: 'Iniciar revisão', exact: true }).click();
  await expect(page.getByText('Conferência confirmada: em_revisao.')).toBeVisible();
  await page.getByLabel('Motivo da conferência').fill(decision === 'return' ? 'Rever evidência sintética' : 'Conferência independente sintética');
  await page.getByRole('button', { name: decision === 'return' ? 'Devolver com motivo' : 'Aceitar evidência', exact: true }).click();
  await expect(page.getByText(`Conferência confirmada: ${decision === 'return' ? 'devolvida' : 'validada'}.`)).toBeVisible();
}

test('seven authenticated journeys preserve correction, independent acceptance, closed snapshot, publication and export across reloads', async ({ page }) => {
  test.setTimeout(180_000);
  // No route interception: every write/read goes through the real API and SQL.
  for (const side of ['NORTE', 'SUL'] as const) {
    const scope = `ACADEMIC-${side}`;
    await loginAcademic(page, side === 'NORTE' ? 'area_tecnica' : 'southTechnical', 'area_tecnica', scope);
    for (const target of [scope, `${scope}-1`, `${scope}-2`]) await fillAndSubmit(page, target);
    await logoutAcademic(page);
    await loginAcademic(page, side === 'NORTE' ? 'revisor_tecnico' : 'southReviewer', 'revisor_tecnico', scope);
    for (const target of [scope, `${scope}-1`, `${scope}-2`]) await review(page, target, target === 'ACADEMIC-NORTE-1' ? 'return' : 'accept');
    await logoutAcademic(page);
  }
  await loginAcademic(page, 'area_tecnica', 'area_tecnica', 'ACADEMIC-NORTE-1');
  await page.getByRole('button', { name: 'ACADEMIC-NORTE-1 · devolvida', exact: true }).click();
  await expect(page.getByText('Motivo da devolução técnica: Rever evidência sintética')).toBeVisible();
  await page.getByLabel('Valor corrigido', { exact: true }).fill('12');
  await page.getByLabel('Justificativa da correção').fill('Nova evidência de demonstração');
  await page.getByRole('button', { name: 'Enviar nova revisão', exact: true }).click();
  await expect(page.getByText('Nova revisão enviada. Resultado sintético: 9.6. Nova conferência necessária.')).toBeVisible();
  await page.reload();
  await chooseAcademicContext(page, 'area_tecnica', 'ACADEMIC-NORTE-1');
  await expect(page.getByRole('button', { name: 'ACADEMIC-NORTE-1 · enviada', exact: true })).toBeVisible();
  await logoutAcademic(page);
  await loginAcademic(page, 'revisor_tecnico', 'revisor_tecnico', 'ACADEMIC-NORTE-1');
  await review(page, 'ACADEMIC-NORTE-1', 'accept');
  await logoutAcademic(page);

  await loginAcademic(page, 'cam', 'cam');
  await expect(page.getByText('Esperadas: 6 · Recebidas: 6 · Conferidas: 6')).toBeVisible();
  await page.getByRole('button', { name: 'Iniciar consolidação', exact: true }).click();
  await expect(page.getByText('Estado do ciclo: em_consolidacao')).toBeVisible();
  await page.getByLabel('Referência do ciclo').fill('DEMO-DECISAO- A');
  await page.getByRole('button', { name: 'Fechar ciclo', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar fechamento', exact: true }).click();
  await expect(page.getByText('Estado do ciclo: fechada')).toBeVisible();
  await expect(page.getByText('Publicação: nao_publicada')).toBeVisible();
  const snapshot = await page.getByText(/^Snapshot fechado:/).textContent();
  await page.reload();
  await chooseAcademicContext(page, 'cam');
  await expect(page.getByText(snapshot!, { exact: true })).toBeVisible();
  await page.getByLabel('Referência do ciclo').fill('DEMO-PUBLICACAO- A');
  await page.getByRole('button', { name: 'Publicar demonstração', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar publicação', exact: true }).click();
  await expect(page.getByText('Publicação: publicada_demo')).toBeVisible();
  for (const name of ['Baixar CSV', 'Baixar manifesto JSON']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name, exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/\.(csv|json)$/);
  }
  await logoutAcademic(page);

  await loginAcademic(page, 'gestor_unidade', 'gestor_unidade', 'ACADEMIC-NORTE-1');
  await expect(page.getByText('12 × 0.8 = 9.6', { exact: true })).toBeVisible();
  await expect(page.getByText(/Publicada na demonstração · Regra v1/)).toBeVisible();
  await logoutAcademic(page);
  await loginAcademic(page, 'gestor_distrital', 'gestor_distrital');
  await expect(page.getByText('10 × 0.8 = 8', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Unidades do território', exact: true }).click();
  await expect(page.getByText('12 × 0.8 = 9.6', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /ACADEMIC-SUL/ })).toHaveCount(0);
  await logoutAcademic(page);
  await loginAcademic(page, 'lideranca', 'lideranca');
  await expect(page.getByText(/Soma de controle: 17.6/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Histórico', exact: true })).toHaveCount(0);
  await logoutAcademic(page);
  await loginAcademic(page, 'administrador', 'administrador');
  await expect(page.getByRole('button', { name: 'Salvar escopo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Vínculos de negócio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar vínculo', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Competências e atribuições', exact: true }).click();
  await expect(page.getByText('ACADEMIC-2026-10 · fechada · versão', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Regras futuras', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Agendar regra futura', exact: true })).toBeVisible();
  await expect(page.getByText('12 × 0.8 = 9.6', { exact: true })).toHaveCount(0);
  await logoutAcademic(page);
});
