import type { Role } from '../pilot/types';
import { competenceLabel, scopeSummary } from './displayNames';

export type AcademicDestination = { id: string; label: string };
const painel = { id: 'painel', label: 'Painel' };
const managerDestinations = [painel, { id: 'resultados', label: 'Resultados' }, { id: 'historico', label: 'Histórico' }];
const destinations: Record<Role, AcademicDestination[]> = {
  area_tecnica: [painel, { id: 'preenchimento', label: 'Preenchimento' }, { id: 'historico', label: 'Histórico' }],
  revisor_tecnico: [painel, { id: 'conferencia', label: 'Conferência' }, { id: 'historico', label: 'Histórico' }],
  cam: [painel, { id: 'ciclo', label: 'Ciclo e fechamento' }, { id: 'resultados', label: 'Resultados' },
    { id: 'entradas', label: 'Todas as entradas' }, { id: 'historico', label: 'Auditoria' }],
  gestor_unidade: managerDestinations,
  gestor_distrital: managerDestinations,
  lideranca: [painel],
  administrador: [painel, { id: 'regras', label: 'Indicadores e regras' },
    { id: 'vinculos', label: 'Usuários e vínculos' }, { id: 'historico', label: 'Auditoria' }],
};

// Navigation is presentation, never authorization. Every mounted page still
// calls its own server-authorized boundary with the selected context.
export function getAcademicDestinations(role: Role): readonly AcademicDestination[] {
  return destinations[role];
}

export function academicPageFromHash(role: Role, hash: string): string {
  const destinations = getAcademicDestinations(role);
  const id = hash.replace(/^#academico\//, '');
  return destinations.find(destination => destination.id === id)?.id ?? destinations[0].id;
}

// Model-3 page title and subtitle, worded like the V4 prototype (spec §4.9).
export function academicPageHeading(role: Role, page: string, view: { competence: string; scopes: readonly string[] }): { title: string; subtitle: string } {
  const M = competenceLabel(view.competence);
  const S = scopeSummary(view.scopes);
  const results = { title: 'Resultados', subtitle: `${M} · só entradas aceitas geram pontos. Pendências não viram zero.` };
  const audit = { title: 'Auditoria', subtitle: 'Todos os eventos registrados, do mais recente ao mais antigo.' };
  const headings: Record<string, { title: string; subtitle: string }> = {
    'area_tecnica:painel': { title: 'Painel', subtitle: `${M} · ${S} · o que fazer agora` },
    'area_tecnica:preenchimento': { title: 'Preenchimento', subtitle: `${M} · regra DEMO-v1 · informe os indicadores e envie em lote` },
    'revisor_tecnico:painel': { title: 'Painel', subtitle: `${M} · você confere o que a área técnica de ${S} enviou` },
    'revisor_tecnico:conferencia': { title: 'Conferência', subtitle: `${M} · confira valor, fonte e cálculo; aceite ou devolva com motivo. Você não confere o que você mesmo enviou.` },
    'cam:painel': { title: `Ciclo de ${M}`, subtitle: 'O que falta para consolidar, fechar e publicar.' },
    'cam:ciclo': { title: 'Ciclo e fechamento', subtitle: 'Fechar congela os resultados; publicar é outro passo.' },
    'cam:resultados': results,
    'cam:entradas': { title: 'Todas as entradas', subtitle: `${M} · leitura de todas as entradas. A conferência é do revisor técnico de cada distrito.` },
    'cam:historico': audit,
    'gestor_distrital:painel': { title: S, subtitle: `${M} · resultado por unidade. Só entradas aceitas geram pontos.` },
    'gestor_distrital:resultados': results,
    'gestor_unidade:painel': { ...results, title: `Resultado da ${S}` },
    'gestor_unidade:resultados': results,
    'lideranca:painel': { title: 'Visão agregada', subtitle: `${M} · situação do ciclo e médias por distrito. Sem detalhes por pessoa.` },
    'administrador:painel': { title: 'Painel de cadastros', subtitle: 'Você mantém vínculos e escopos; indicadores e regras entram por migração. Administradores não veem valores nem pontuações.' },
    'administrador:regras': { title: 'Indicadores e regras', subtitle: 'Uma regra em uso não muda; mudanças valem só para competências futuras.' },
    'administrador:vinculos': { title: 'Usuários e vínculos', subtitle: 'Cada vínculo junta pessoa, papel e escopo. Ninguém concede acesso a si mesmo.' },
    'administrador:historico': audit,
  };
  if (page === 'historico' && !headings[`${role}:historico`]) return { title: 'Histórico', subtitle: 'Eventos do seu escopo, do mais recente ao mais antigo.' };
  // Pages come from academicPageFromHash, so every pair is listed; the label is a safe fallback.
  return headings[`${role}:${page}`] ?? { title: getAcademicDestinations(role).find(d => d.id === page)?.label ?? page, subtitle: '' };
}

export function requestAcademicLeave(): boolean {
  return window.dispatchEvent(new Event('academic:beforeleave', { cancelable: true }));
}
