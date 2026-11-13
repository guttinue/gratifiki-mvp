import type { ContextGroup } from "../pilot/types";
import { competenceLabel, competenceStateLabels, roleLabels } from "../workspace/displayNames";

const optionFor = (group: ContextGroup) => {
  const { mode, competenciaEstado } = group.contexts[0];
  const label = group.modelo === 3
    ? [roleLabels[group.role], competenceLabel(group.competenciaCodigo), competenciaEstado && competenceStateLabels[competenciaEstado]].filter(Boolean).join(" · ")
    : `${group.role} · ${group.escopoCodigo} · ${group.competenciaCodigo} · ${mode === "legacy" ? "legado" : "acadêmico"}`;
  return <option key={group.key} value={group.key}>{label}</option>;
};

export function ContextPicker({ groups, selectedKey, onSelect }: {
  groups: ContextGroup[]; selectedKey: string | null; onSelect: (key: string) => void;
}) {
  const academic = groups.filter((group) => group.modelo === 3);
  const baseline = groups.filter((group) => group.modelo !== 3);
  return <label className="field">Contexto autorizado
    <select className="input" value={selectedKey ?? ""} onChange={(event) => onSelect(event.target.value)}>
      <option value="" disabled>Selecione um contexto</option>
      {academic.length > 0 && <optgroup label="Gratifiki · regra DEMO-v1">{academic.map(optionFor)}</optgroup>}
      {baseline.length > 0 && <optgroup label="Baseline legada">{baseline.map(optionFor)}</optgroup>}
    </select>
  </label>;
}
