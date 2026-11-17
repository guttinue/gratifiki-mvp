import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthorizedContext, ContextGroup } from '../pilot/types';
import type { AuditItem } from '../pilot/types';
import { Fragment, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toCommandContext } from '../context/contextApi';
import { auditActions, auditCategories, plural, roleLabels } from '../workspace/displayNames';
import { auditDay, auditHour, loadAudit, loadGroupAudit } from './auditApi';
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
const pageSize = 25;
// The sentence of one history line (HI-02): "Verbo **alvo**: motivo · Papel". Unknown actions show their code alone.
export function auditLine(row: AuditItem, targets: Map<string, string>) {
    const known = Object.hasOwn(auditActions, row.action) ? auditActions[row.action] : null;
    return known ? { verb: known.verb, target: targets.get(row.resourceId), reason: row.reason, role: known.role }
        : { verb: row.action, target: undefined, reason: null, role: null };
}
function GroupAudit({ client, group }: { client: SupabaseClient; group: ContextGroup }) {
    const [category, setCategory] = useState('todos');
    const [shown, setShown] = useState(pageSize);
    const [data, setData] = useState<Awaited<ReturnType<typeof loadGroupAudit>> | null>(null);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    const list = useRef<HTMLElement>(null);
    useEffect(() => {
        let current = true;
        setData(null);
        setError(false);
        void loadGroupAudit(client, group).then(value => {
            if (current) setData(value);
        }).catch(() => {
            if (current) setError(true);
        });
        return () => { current = false; };
    }, [client, group, retry]);
    const actions = auditCategories.find(c => c.id === category)?.actions;
    const events = data ? data.items.filter(i => !actions || actions.includes(i.action)) : [];
    const now = new Date();
    const days: { day: string; items: AuditItem[] }[] = [];
    for (const row of events.slice(0, shown)) {
        const day = auditDay(row.occurredAt, now);
        if (days.at(-1)?.day === day) days.at(-1)?.items.push(row);
        else days.push({ day, items: [row] });
    }
    const more = () => {
        flushSync(() => setShown(n => n + pageSize));
        list.current?.querySelectorAll('li')[shown]?.focus();
    };
    return <section aria-label="Histórico autorizado">
        <div className="toolbar">
            <label>Mostrar <select value={category} onChange={e => { setCategory(e.target.value); setShown(pageSize); }}>
                {auditCategories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select></label>
            {data && <span aria-live="polite">{Math.min(shown, events.length)} de {plural(events.length, 'evento', 'eventos')}</span>}
        </div>
        {error ? <p role="alert">Não foi possível confirmar o histórico autorizado. Verifique os filtros e o acesso.</p>
            : !data ? <p role="status">Carregando histórico…</p> : <>
                {data.truncated && <p className="v3-note">Há eventos mais antigos que não foram carregados.</p>}
                {!events.length ? <p>Nenhum evento autorizado neste filtro.</p> : <section className="box log" aria-label="Eventos" ref={list}>
                    {days.map(({ day, items }) => <Fragment key={day}>
                        <h3 className="log-day">{day}</h3>
                        <ul>{items.map(row => {
                            const { verb, target, reason, role } = auditLine(row, data.targets);
                            return <li key={row.id} tabIndex={-1}>
                                <time dateTime={row.occurredAt}>{auditHour(row.occurredAt)}</time>
                                <p>{verb}{target && <> <strong className="target">{target}</strong></>}{reason && `: ${reason}`}{role && <> <span className="role">· {roleLabels[role]}</span></>}</p>
                            </li>;
                        })}</ul>
                    </Fragment>)}
                    {events.length > shown && <div className="log-more"><button type="button" onClick={more}>Carregar mais</button></div>}
                </section>}
            </>}
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
