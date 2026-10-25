import type { AuthorizedContext } from "../pilot/types";

export function ContextPicker({ contexts, selectedKey, onSelect }: {
  contexts: AuthorizedContext[]; selectedKey: string | null; onSelect: (key: string) => void;
}) {
  return <label>Contexto autorizado
    <select value={selectedKey ?? ""} onChange={(event) => onSelect(event.target.value)}>
      <option value="" disabled>Selecione um contexto</option>
      {contexts.map((context) => <option key={context.key} value={context.key}>
        {context.role} · {context.escopoCodigo} · {context.competenciaCodigo} · {context.mode === "legacy" ? "legado" : "acadêmico"}
      </option>)}
    </select>
  </label>;
}
