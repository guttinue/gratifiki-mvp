import type { AssistiveRow } from './assistiveContract.ts';
import { historicalMedian, prepareAssistiveSeries } from './prepareSeries.ts';

// No file, database, network or notebook input: this fixture is invented here.
if (process.argv.length > 2) {
  console.error('synthetic_fixture_only: este exemplo não aceita argumentos ou arquivos.');
  process.exitCode = 1;
} else {
  const fixture: AssistiveRow[] = [
    { month: '2026-07', value: '10', dataState: 'valor' },
    { month: '2026-08', value: '12', dataState: 'valor' },
    { month: '2026-09', value: '11', dataState: 'valor' },
    { month: '2026-10', value: '100', dataState: 'valor' },
    { month: '2026-06', value: null, dataState: 'ausente' },
  ].map((entry) => ({
    ...entry, indicatorCode: 'DEMO-01', scopeCode: 'SYNTHETIC-ONLY',
    ruleVersion: 1, unit: 'contagem',
  } as AssistiveRow));
  const asOfMonth = '2026-10';
  console.log(JSON.stringify({
    synthetic: true,
    purpose: 'Teste pedagógico offline; não é previsão, modelo validado ou regra SESAU.',
    asOfMonth,
    prepared: prepareAssistiveSeries(fixture, asOfMonth),
    candidateHistoricalMedian: historicalMedian(fixture, asOfMonth),
    limitations: 'Massa curta testa código, não desempenho preditivo. Experimento real exige autorização e revisão do subgrupo/professor.',
  }, null, 2));
}
