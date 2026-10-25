import { Component, type ReactNode } from 'react';

export class AcademicLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) return <main className="auth-screen"><section className="auth-card">
      <h1>Espaço acadêmico indisponível</h1>
      <p role="alert">Não foi possível carregar o espaço acadêmico. Verifique a conexão e recarregue. Nenhuma outra jornada foi aberta.</p>
      <button type="button" onClick={() => window.location.reload()}>Recarregar espaço</button>
    </section></main>;
    return this.props.children;
  }
}
