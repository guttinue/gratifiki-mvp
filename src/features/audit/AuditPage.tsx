import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext } from '../pilot/types';
import type { AuditItem } from '../pilot/types';
import { useEffect, useState } from 'react';
import { toCommandContext } from '../context/contextApi';
import { loadAudit } from './auditApi';
type Props = {
    client: SupabaseClient;
    context: AuthorizedContext;
};
const auditTime = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Recife' });
function formatAuditTime(value: string) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? auditTime.format(date) : 'Horário indisponível';
}
export function AuditPage(props: Props) {
    return <ContextAudit key={props.context.key} {...props}/>;
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
