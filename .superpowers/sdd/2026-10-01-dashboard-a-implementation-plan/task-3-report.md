# Task 3 — E2E, responsividade, README e pgTAP

## Entrega

- Adicionada cobertura Playwright do fluxo do dashboard, navegação por hash, filtros, detalhes, métricas relativas, erro de leitura, operações em andamento, logout e larguras de 1440/390/320 px.
- Atualizada a jornada SR1 para testar envios `10 → 8` e `0 → 0`, persistência e detalhe por ID, histórico humanizado com código técnico, retry idempotente após resposta perdida, perfil CAM somente leitura, validação na interface/API e sessão expirada.
- Centralizado o guard E2E que exige endpoint HTTP em loopback antes de autenticar e informa apenas nomes de variáveis ausentes; leituras de IDs aguardam a tabela sair do estado de carregamento.
- Atualizadas instruções locais e de parada dos serviços no README, incluindo execução sanitizada de E2E/pgTAP sem reset.
- Tornados relativos à linha de base preenchida os asserts de acesso e de ausência de gravações parciais no pgTAP. Fixture, casos negativos, permissões e RPCs de produto permaneceram inalterados.

## TDD e verificação

- RED inicial do pgTAP na base local preenchida: 121 asserts, 6 falhas por expectativas absolutas (`02_access`: esperava 1, encontrou 19; `03_submit_entry`: esperava 3, encontrou 21). Os arquivos de teste foram corrigidos para comparar baseline mais fixtures/submissões legítimas.
- GREEN final de pgTAP, executado depois da rodada E2E e sem reset: 3 arquivos, 121/121 asserts, PASS.
- Playwright integral, um worker: `npm run test:e2e -- --workers=1` — 12 passaram, 0 falharam (25,0 s). A saída foi sanitizada; traces estão desativados nos specs de autenticação.
- Unitários: `npm test -- --run` — 13 arquivos, 104/104 testes passaram.
- `npm run lint`, `npm run typecheck`, `npm run build` e `git diff --check`: todos com exit 0.

As gravações da prova E2E são sintéticas e ficam na instância local; não houve limpeza ou exclusão dos registros. A verificação visual independente no navegador permanece com o controller/revisor. Nenhum código ou SQL de produto foi modificado.
