import { formatDecimal } from '../pilot/decimal';
import type { UnitResultItem } from './resultsApi';

export const directionSymbol = (direction: UnitResultItem['direction']) => direction === 'maior_melhor' ? '≥' : '≤';

// Explains one accepted item from what the server returned: the expression it
// computed, the weight it used and whether that weight was redistributed.
export function CalculationExplainer({ item, onClose }: { item: UnitResultItem; onClose: () => void }) {
  const redistributed = item.effectiveWeight !== null && item.effectiveWeight !== item.weight;
  return <section className="v3-explainer" aria-label={`Cálculo de ${item.indicatorCode}`}>
    <h4>{item.name}</h4>
    <p><code>{item.expression}</code></p>
    <p>{`= ${formatDecimal(item.points ?? '0', 2)} pontos`}</p>
    <ul>
      <li>{`Valor validado: ${formatDecimal(item.inputValue ?? '0')}`}</li>
      <li>{`Meta: ${directionSymbol(item.direction)} ${formatDecimal(item.meta)}`}</li>
      <li>{`Peso efetivo: ${formatDecimal(item.effectiveWeight ?? item.weight)} (peso nominal ${formatDecimal(item.weight)})`}</li>
      <li>{redistributed ? 'Modo: pesos redistribuídos entre os indicadores com valor aceito.' : 'Modo: pesos mantidos.'}</li>
    </ul>
    <button type="button" onClick={onClose}>Fechar</button>
  </section>;
}
