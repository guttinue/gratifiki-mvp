import type { ContextGroup } from "../pilot/types";

export function ContextPicker({ groups, selectedKey, onSelect }: {
  groups: ContextGroup[]; selectedKey: string | null; onSelect: (key: string) => void;
}) {
  return <label>Contexto autorizado
    <select value={selectedKey ?? ""} onChange={(event) => onSelect(event.target.value)}>
      <option value="" disabled>Selecione um contexto</option>
      {groups.map((group) => <option key={group.key} value={group.key}>
        {group.role} · {group.escopoCodigo} · {group.competenciaCodigo} · {group.contexts[0].mode === "legacy" ? "legado" : "acadêmico"}
      </option>)}
    </select>
  </label>;
}
