import type { ReactNode } from 'react';
import { countByStatus, statusTones, type Tone } from './displayNames';

// V4 parts shared by several screens (index.html lines 623-666).
export function StageTiles({ label, tiles }: { label: string; tiles: { label: string; value: string | number; sub: string; tone?: Tone; text?: boolean }[] }) {
  return (
    <section className="tiles" aria-label={label}>
      {tiles.map((tile) => (
        <div className="tile" key={tile.label}>
          <span className="tile-label">{tile.tone && <i className={`dot t-${tile.tone}`} aria-hidden="true" />}{tile.label}</span>
          <span className={tile.text ? 'tile-n txt' : 'tile-n'}>{tile.value}</span>
          <span className="tile-sub">{tile.sub}</span>
        </div>
      ))}
    </section>
  );
}

type TodoItem = { tone: Tone; title: string; sub?: string; action?: { label: string; ariaLabel?: string; onClick: () => void } };

export function TodoList({ title, items, empty }: { title: string; items: TodoItem[]; empty: ReactNode }) {
  const id = `todo-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section className="block" aria-labelledby={id}>
      <div className="block-head">
        {/* The pill is aria-hidden so the region keeps its exact name (preflight F13). */}
        <h3 id={id}>{title}{items.length > 0 && <span className="pill" aria-hidden="true">{items.length}</span>}</h3>
      </div>
      <div className="box">
        {items.length ? (
          <ul className="todo">
            {items.map((item, index) => (
              <li key={`${item.title}-${index}`}>
                <i className={`dot t-${item.tone}`} aria-hidden="true" />
                <div className="todo-txt"><strong>{item.title}</strong>{item.sub && <span>{item.sub}</span>}</div>
                {item.action && <button type="button" className={index === 0 ? 'primary' : undefined} aria-label={item.action.ariaLabel} onClick={item.action.onClick}>{item.action.label}</button>}
              </li>
            ))}
          </ul>
        ) : <div className="empty">{empty}</div>}
      </div>
    </section>
  );
}

// V4 order and wording of the bar (spec §5.1).
const barOrder = [['validada', 'aceita'], ['em_revisao', 'em conferência'], ['enviada', 'aguardando conferência'], ['devolvida', 'devolvida'], ['rascunho', 'rascunho'], ['ausente', 'não enviado']] as const;

export function StackBar({ counts }: { counts: ReturnType<typeof countByStatus> }) {
  const shown = barOrder.filter(([status]) => counts[status]);
  return (
    <span className="stackbar" role="img" aria-label={shown.map(([status, name]) => `${counts[status]} ${name}`).join(', ')}>
      {shown.map(([status]) => <span key={status} className={`t-${statusTones[status]}`} style={{ width: `${(counts[status] / counts.total) * 100}%` }} />)}
    </span>
  );
}

export function UnitCard({ title, sub, badge, big, bar, foot, action }: {
  title: string; sub?: string; badge?: ReactNode; big: ReactNode; bar?: ReactNode; foot?: ReactNode;
  action: { label: string; ariaLabel?: string; onClick: () => void };
}) {
  return (
    <article className="box ucard">
      <header><div><h4>{title}</h4>{sub && <span className="sub">{sub}</span>}</div>{badge}</header>
      <div className="big">{big}</div>
      {bar}
      {foot && <span className="sub">{foot}</span>}
      <button type="button" aria-label={action.ariaLabel} onClick={action.onClick}>{action.label}</button>
    </article>
  );
}
