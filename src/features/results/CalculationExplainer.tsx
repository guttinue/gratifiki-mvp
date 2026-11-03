import { formatDecimal } from '../pilot/decimal';
import type { AbsenceMode, UnitResultItem } from './resultsApi';

export const directionSymbol = (direction: UnitResultItem['direction']) => direction === 'maior_melhor' ? '≥' : '≤';
// What a value-less situation (unavailable or not applicable) means for the score, per absence mode (design §4.1).
export const absenceCopy: Record<AbsenceMode, string> = {
  zero: 'Indisponível ou não se aplica entra com 0 pontos neste conjunto (modo zero), após decisão da CAM.',
  redistribuir: 'Indisponível ou não se aplica não pontua; o peso é redistribuído entre os demais indicadores, após decisão da CAM.',
};

// Explains one accepted item from what the server returned: the expression it
// computed, the weight it used and the absence mode of the competence's rule set.
export function CalculationExplainer({ item, mode, onClose }: { item: UnitResultItem; mode: AbsenceMode; onClose: () => void }) {
  return <section className="v3-explainer" aria-label={`Cálculo de ${item.indicatorCode}`}>
    <h4>{item.name}</h4>
    <p><code>{item.expression}</code></p>
    <p>{`= ${formatDecimal(item.points ?? '0', 2)} pontos`}</p>
    <ul>
      <li>{`Valor validado: ${formatDecimal(item.inputValue ?? '0')}`}</li>
      <li>{`Meta: ${directionSymbol(item.direction)} ${formatDecimal(item.meta)}`}</li>
      <li>{`Peso efetivo: ${formatDecimal(item.effectiveWeight ?? item.weight)} (peso nominal ${formatDecimal(item.weight)})`}</li>
      <li>{mode === 'zero' ? 'Modo: ausências valem zero.' : 'Modo: pesos redistribuídos.'}</li>
    </ul>
    <button type="button" onClick={onClose}>Fechar</button>
  </section>;
}
