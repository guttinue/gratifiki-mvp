import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';

type Register = (owner: object, dirty: boolean) => void;
const SafetyContext = createContext<Register | null>(null);

export function NavigationSafety({ children }: { children: ReactNode }) {
  const drafts = useRef(new Set<object>());
  const register = useCallback<Register>((owner, dirty) => {
    if (dirty) drafts.current.add(owner);
    else drafts.current.delete(owner);
  }, []);
  useEffect(() => {
    const guard = (event: Event) => {
      if (drafts.current.size && !window.confirm('Há alterações não salvas ou uma operação pendente. Sair desta tela pode descartá-las. Deseja continuar?')) event.preventDefault();
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (drafts.current.size) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('academic:beforeleave', guard);
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('academic:beforeleave', guard);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  return <SafetyContext.Provider value={register}>{children}</SafetyContext.Provider>;
}

// A form owns its dirty/pending state. The shell never inspects private fields,
// writes draft content to storage or infers whether a server command committed.
export function useNavigationDraft(dirty: boolean) {
  const register = useContext(SafetyContext);
  const owner = useRef({});
  useLayoutEffect(() => {
    const token = owner.current;
    register?.(token, dirty);
    return () => register?.(token, false);
  }, [dirty, register]);
}
