import type { EntryState, PilotEntry } from "../../lib/types";

export const WORKSPACE_PAGES = ["overview", "entries", "history"] as const;
export type WorkspacePage = (typeof WORKSPACE_PAGES)[number];
export type EntryStateFilter = EntryState | "all";

export const STATUS_LABELS: Record<EntryState, string> = {
  pendente: "Pendente",
  validada: "Validada",
  corrigida: "Corrigida",
  fechada: "Fechada",
  invalidada: "Invalidada",
};

export const STATUS_FILTERS: Array<{ value: EntryStateFilter; label: string }> = [
  { value: "all", label: "Todos os estados" },
  { value: "pendente", label: STATUS_LABELS.pendente },
  { value: "validada", label: STATUS_LABELS.validada },
  { value: "corrigida", label: STATUS_LABELS.corrigida },
  { value: "fechada", label: STATUS_LABELS.fechada },
  { value: "invalidada", label: STATUS_LABELS.invalidada },
];

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "demo.entry.submitted": "Entrada enviada",
};

export function formatAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export interface WorkspaceMetrics {
  entries: number;
  results: number;
  pending: number;
  events: number;
}

export function getWorkspaceMetrics(entries: PilotEntry[]): WorkspaceMetrics {
  return entries.reduce<WorkspaceMetrics>((metrics, entry) => {
    metrics.entries += 1;
    metrics.results += entry.results.length;
    metrics.pending += entry.state === "pendente" ? 1 : 0;
    metrics.events += entry.auditEvents.length;
    return metrics;
  }, { entries: 0, results: 0, pending: 0, events: 0 });
}

export function filterPilotEntries(
  entries: PilotEntry[],
  searchText: string,
  state: EntryStateFilter,
): PilotEntry[] {
  const search = searchText.trim().toLocaleLowerCase("pt-BR");
  return entries.filter((entry) => {
    if (state !== "all" && entry.state !== state) return false;
    if (!search) return true;
    return `${entry.id} ${entry.inputValue}`.toLocaleLowerCase("pt-BR").includes(search);
  });
}

export function pageFromHash(hash: string): WorkspacePage {
  const value = hash.startsWith("#") ? hash.slice(1) : hash;
  return WORKSPACE_PAGES.find((page) => page === value) ?? "overview";
}

export function pageHash(page: WorkspacePage): string {
  return `#${page}`;
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "Horário de envio indisponível";
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "Horário de envio indisponível";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(timestamp);
}

export const PAGE_LABELS: Record<WorkspacePage, string> = {
  overview: "Visão geral",
  entries: "Entradas",
  history: "Histórico e auditoria",
};
