import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext, ContextGroup } from '../pilot/types';
import type { AuditItem } from '../pilot/types';
import { useEffect, useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { loadGroupPositions } from '../batch/groupPositions';
import { auditActions, roleLabels, scopeName } from '../workspace/displayNames';
import { loadAudit, loadNewestAudit, mergeAuditPages } from './auditApi';
type Props = {
    client: SupabaseClient;
    context: AuthorizedContext;
    group?: ContextGroup;
};
const auditTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Recife' });
function formatAuditTime(value: string) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? auditTime.format(date) : 'Horário indisponível';
}
export function AuditPage(props: Props) {
    return props.group?.modelo === 3 ? <GroupAudit key={props.group.key} client={props.client} group={props.group}/>
        : <ContextAudit key={props.context.key} {...props}/>;
}
// Only these roles have operational_read; for the others a position read would be refused (42501).
const namesTargets = new Set(['area_tecnica', 'revisor_tecnico', 'cam']);
const pageSize = 25;
// §4.7: get_scoped_audit answers per context, so the view reads each one's newest 100, merges and pages locally.
function GroupAudit({ client, group }: { client: SupabaseClient; group: ContextGroup }) {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [action, setAction] = useState('');
    const [filterAction, setFilterAction] = useState('');
    const [data, setData] = useState<{ items: AuditItem[]; truncated: boolean; targets: Map<string, string> } | null>(null);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let current = true;
        setData(null);
        setError(false);
        const filters = { ...(query ? { search: query } : {}), ...(filterAction ? { status: filterAction } : {}) };
        void Promise.all([
            Promise.all(group.contexts.map(c => loadNewestAudit(client, toCommandContext(c), filters))),
            namesTargets.has(group.role) ? loadGroupPositions(client, group) : [],
        ]).then(([pages, positions]) => {
            const targets = new Map(positions.map(({ position: p }) => [p.id, [scopeName(p.escopoCodigo), p.indicatorCode].filter(Boolean).join(' · ')]));
            const merged = mergeAuditPages(pages);
            // A cut context lacks events before its oldest shown one; drop the others' older ones so no gap stays hidden.
            const cutoff = Math.max(...pages.filter(p => p.items.length && p.total > p.items.length).map(p => Math.min(...p.items.map(i => Date.parse(i.occurredAt)))));
            if (current) setData({ ...merged, items: merged.items.filter(i => Date.parse(i.occurredAt) >= cutoff), targets });
        }).catch(() => {
            if (current) setError(true);
        });
        return () => { current = false; };
    }, [client, group, query, filterAction, retry]);
    const line = (row: AuditItem) => {
        const known = Object.hasOwn(auditActions, row.action) ? auditActions[row.action] : null;
        const target = data?.targets.get(row.resourceId);
        return { text: known ? `${known.verb}${target ? ` ${target}` : ''}${row.reason ? `: ${row.reason}` : ''}` : row.action, role: known && roleLabels[known.role] };
    };
    return <section aria-label="Histórico autorizado">
        <form onSubmit={e => {
            e.preventDefault();
            setQuery(search);
            setFilterAction(action);
            setPage(1);
        }}>
            <label>{group.role === 'administrador' ? 'Buscar ação' : 'Buscar ação ou alvo'}
                <input value={search} onChange={e => setSearch(e.target.value)}/>
            </label>
            <label>Ação exata<input value={action} onChange={e => setAction(e.target.value)}/></label>
            <button type="submit">Filtrar histórico</button>
        </form>
        {error ? <p role="alert">Não foi possível confirmar o histórico autorizado. Verifique os filtros e o acesso.</p>
            : !data ? <p role="status">Carregando histórico…</p> : <div className="v3-panel">
                {data.truncated && <p className="v3-note">Há eventos mais antigos; use o filtro de ação.</p>}
                {!data.items.length && <p>Nenhum evento autorizado neste filtro.</p>}
                <ol className="timeline">{data.items.slice((page - 1) * pageSize, page * pageSize).map(row => {
                    const { text, role } = line(row);
                    return <li key={row.id}>
                        <time dateTime={row.occurredAt}>{formatAuditTime(row.occurredAt)}</time>
                        <div><strong>{text}</strong>{role && <span className="v3-cell-sub">{role}</span>}</div>
                    </li>;
                })}</ol>
                <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Eventos anteriores</button>
                <span> Página {page} </span>
                <button type="button" disabled={page * pageSize >= data.items.length} onClick={() => setPage(p => p + 1)}>Próximos eventos</button>
            </div>}
        <button type="button" onClick={() => setRetry(n => n + 1)}>Atualizar histórico</button>
    </section>;
}
function ContextAudit({ client, context }: Props) {
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState('');
    const [query, setQuery] = useState('');
    const [action, setAction] = useState('');
    const [filterAction, setFilterAction] = useState('');
    const [data, setData] = useState<{
        items: AuditItem[];
        total: number;
    } | null>(null);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        let current = true;
        setData(null);
        setError(false);
        void loadAudit(client, toCommandContext(context), {
            page,
            pageSize: 25,
            ...(query ? { search: query } : {}),
            ...(filterAction ? { status: filterAction } : {}),
        }).then(value => {
            if (current) setData(value);
        }).catch(() => {
            if (current) setError(true);
        });
        return () => { current = false; };
    }, [client, context, page, query, filterAction, retry]);
    return <section aria-label="Histórico autorizado">
        <h2>{context.role === 'administrador' ? 'Auditoria administrativa' : 'Histórico autorizado'}</h2>
        <p>{context.competenciaCodigo} · {context.escopoCodigo}</p>
        <form onSubmit={e => {
            e.preventDefault();
            setQuery(search);
            setFilterAction(action);
            setPage(1);
        }}>
            <label>{context.role === 'administrador' ? 'Buscar ação' : 'Buscar ação ou alvo'}
                <input value={search} onChange={e => setSearch(e.target.value)}/>
            </label>
            <label>Ação exata<input value={action} onChange={e => setAction(e.target.value)}/></label>
            <button type="submit">Filtrar histórico</button>
        </form>
        {error ? <p role="alert">Não foi possível confirmar o histórico autorizado. Verifique os filtros e o acesso.</p>
            : !data ? <p role="status">Carregando histórico…</p> : <>
                <p>Eventos no filtro: {data.total}</p>
                {!data.items.length && <p>Nenhum evento autorizado neste filtro.</p>}
                <ol>{data.items.map(row => <li key={row.id}>
                    <strong>{row.action}</strong>
                    <p><time dateTime={row.occurredAt}>{formatAuditTime(row.occurredAt)}</time> · Recurso {row.resourceId} · Versão {row.version ?? '—'}</p>
                    {row.reason !== null && <p>{row.reason}</p>}
                </li>)}</ol>
                <button type="button" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Eventos anteriores</button>
                <span> Página {page} </span>
                <button type="button" disabled={page * 25 >= data.total} onClick={() => setPage(p => p + 1)}>Próximos eventos</button>
            </>}
        <button type="button" onClick={() => setRetry(n => n + 1)}>Atualizar histórico</button>
    </section>;
}
