import { useRef, type ReactNode } from "react";
import type { PilotContext } from "../../lib/types";
import { PAGE_LABELS, pageHash, WORKSPACE_PAGES, type WorkspacePage } from "./workspaceModel";
import type { Role } from '../pilot/types';
import { getAcademicDestinations } from './academicNavigation';
export function AcademicNavigation({role,page,onNavigate}:{role:Role;page:string;onNavigate:(page:string)=>void}){
 return <nav aria-label="Navegação acadêmica">{getAcademicDestinations(role).map(destination=><button key={destination.id} type="button" aria-current={page===destination.id?'page':undefined} aria-pressed={page===destination.id} onClick={()=>onNavigate(destination.id)}>{destination.label}</button>)}</nav>;
}

interface WorkspaceShellProps {
  context: PilotContext;
  page: WorkspacePage;
  onNavigate: (page: WorkspacePage) => void;
  onSignOut: () => void;
  isSigningOut: boolean;
  signOutError?: string | null;
  children: ReactNode;
}

export function WorkspaceShell({
  context,
  page,
  onNavigate,
  onSignOut,
  isSigningOut,
  signOutError = null,
  children,
}: WorkspaceShellProps) {
  const roleLabel = context.papel === "area_tecnica" ? "Área técnica" : "CAM · leitura";
  const contentRef = useRef<HTMLElement>(null);

  return (
    <div className="workspace-app">
      <a
        className="skip-link"
        href="#workspace-content"
        onClick={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        Pular para o conteúdo
      </a>
      <aside aria-label="Barra lateral" className="workspace-sidebar">
        <a className="brand-lockup" href="#overview" onClick={(event) => {
          event.preventDefault();
          onNavigate("overview");
        }}>
          <span aria-hidden="true" className="brand-mark">g</span>
          <span>gratifiki</span>
        </a>

        <div className="sidebar-context">
          <span className="sidebar-kicker">PILOTO LOCAL</span>
          <strong>Demonstração sintética</strong>
          <span>{context.competenciaCodigo}</span>
        </div>

        <nav aria-label="Navegação principal" className="workspace-nav">
          <p className="nav-section-label">ESPAÇO DE TRABALHO</p>
          {WORKSPACE_PAGES.map((destination) => (
            <a
              aria-current={page === destination ? "page" : undefined}
              className={`nav-link${page === destination ? " is-active" : ""}`}
              href={pageHash(destination)}
              key={destination}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(destination);
              }}
            >
              <span aria-hidden="true" className={`nav-glyph nav-glyph-${destination}`} />
              <span>{PAGE_LABELS[destination]}</span>
              {destination === "entries" && <span aria-hidden="true" className="nav-arrow">›</span>}
            </a>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span aria-hidden="true" className="status-indicator" />
            <span>Dados locais e sintéticos</span>
          </div>
          <div className="sidebar-user">
            <span aria-hidden="true" className="user-avatar">{roleLabel === "Área técnica" ? "AT" : "CA"}</span>
            <span className="sidebar-user-copy">
              <strong>{roleLabel}</strong>
              <span>{context.escopoCodigo}</span>
            </span>
          </div>
        </div>
      </aside>

      <div className="workspace-main-shell">
        <header className="workspace-topbar">
          <div aria-label={`Página ${PAGE_LABELS[page]}`} className="breadcrumb">
            <span>Gratifiki</span>
            <span aria-hidden="true">/</span>
            <strong>{PAGE_LABELS[page]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="environment-chip"><span aria-hidden="true" />Ambiente local</span>
            <button className="signout-button" disabled={isSigningOut} onClick={onSignOut} type="button">
              {isSigningOut ? "Saindo…" : "Sair"}
            </button>
          </div>
        </header>

        <main className="workspace-content" id="workspace-content" ref={contentRef} tabIndex={-1}>
          <aside aria-label="Aviso do ambiente" className="environment-notice">
            <span aria-hidden="true" className="notice-symbol">i</span>
            <p><strong>Ambiente local · dados sintéticos</strong><span>Regra de demonstração; os registros não representam cálculo oficial nem validação institucional.</span></p>
            <span className="context-chip">{context.indicadorCodigo} <span aria-hidden="true">·</span> {context.escopoCodigo}</span>
          </aside>
          {signOutError && <p className="workspace-error" role="alert">{signOutError}</p>}
          {children}
          <footer className="workspace-footer">
            <span>Gratifiki · piloto local</span>
            <span>Perfil autorizado: {roleLabel} <span aria-hidden="true">·</span> {context.escopoCodigo}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
