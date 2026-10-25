import type { SupabaseClient } from '@supabase/supabase-js';
import type { CommandContext, DashboardData, Page } from '../pilot/types';
import { DomainCommandError } from '../pilot/commandApi';
export function readObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new DomainCommandError('invalid_input');
    }
    return value as Record<string, unknown>;
}
export function readText(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new DomainCommandError('invalid_input');
    }
    return value;
}
export function readInteger(value: unknown, min = 0): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
        throw new DomainCommandError('invalid_input');
    }
    return value;
}
export function readNullableText(value: unknown): string | null {
    return value === null ? null : readText(value);
}
export function readDecimal(value: unknown): string | null {
    if (value === null) return null;
    const s = readText(value);
    if (!/^(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/.test(s)) {
        throw new DomainCommandError('invalid_input');
    }
    return s;
}
export function readArray<T>(value: unknown, decode: (v: unknown) => T): T[] {
    if (!Array.isArray(value)) throw new DomainCommandError('invalid_input');
    return value.map(decode);
}
export function readPage<T>(value: unknown, decode: (v: unknown) => T): Page<T> {
    const r = readObject(value);
    const page = {
        items: readArray(r.items, decode),
        total: readInteger(r.total),
        page: readInteger(r.page, 1),
        pageSize: readInteger(r.pageSize, 1),
    };
    if (page.pageSize > 100 || page.items.length > page.pageSize || page.items.length > page.total) {
        throw new DomainCommandError('invalid_input');
    }
    return page;
}
export async function readRpc(client: SupabaseClient, name: string, context: CommandContext, args: Record<string, unknown> = {}): Promise<unknown> {
    const { data, error } = await client.rpc(name, {
        ...args,
        p_contexto: {
            vinculoId: context.vinculoId,
            competenciaId: context.competenciaId,
            indicadorId: context.indicadorId,
        },
    });
    if (error)
        throw new DomainCommandError(error.code === '42501' ? 'access_denied' : error.code === '22023' ? 'invalid_input' : 'network_error');
    return data;
}
export async function loadDashboard(client: SupabaseClient, context: CommandContext): Promise<DashboardData> {
    const r = readObject(await readRpc(client, 'get_dashboard', context));
    const result: DashboardData = {
        expected: readInteger(r.expected),
        received: readInteger(r.received),
        reviewed: readInteger(r.reviewed),
        unavailable: readInteger(r.unavailable),
        cards: readArray(r.cards, item => {
            const c = readObject(item);
            const f = c.filter === null ? null : readObject(c.filter);
            return {
                id: readText(c.id),
                label: readText(c.label),
                count: readInteger(c.count),
                filter: f === null ? null : {
                    page: readInteger(f.page, 1),
                    pageSize: readInteger(f.pageSize, 1),
                    ...(f.status === undefined ? {} : { status: readText(f.status) }),
                },
            };
        }),
    };
    if (result.received > result.expected || result.reviewed > result.received || result.unavailable > result.received || result.cards.some(c => c.count > result.expected || (c.filter && c.filter.pageSize > 100)))
        throw new DomainCommandError('invalid_input');
    return result;
}
