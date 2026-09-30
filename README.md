# Gratifiki MVP local

Este repositório contém um MVP acadêmico executado localmente. A tela inicial informa que este é um ambiente de demonstração; ela não declara validação institucional nem se conecta a dados ou serviços da SESAU.

## Pré-requisitos

- Node.js 22.12 ou superior e npm.
- Docker Desktop, OrbStack ou outro runtime compatível com a API do Docker, com o daemon ativo.
- O Supabase CLI é instalado como dependência deste projeto; não é necessário instalá-lo globalmente.

## Preparação local

```sh
npm ci
npx supabase start
```

Copie `.env.example` para `.env.local` e configure apenas `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` com os valores locais exibidos pelo Supabase CLI. A chave publicável pode chegar ao navegador; não coloque chaves secretas, senhas ou a `service_role` em variáveis `VITE_*`.

```sh
npm run dev
```

O Vite disponibiliza a aplicação em `http://localhost:5173`.

## Contas fictícias de demonstração

`npm run demo:users` cria duas identidades locais: uma conta `area_tecnica` (perfil técnico) e uma conta `cam` (perfil de revisão), ambas vinculadas ao escopo fictício do piloto. Para esse script, configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` local e as variáveis `DEMO_TECHNICAL_*` e `DEMO_CAM_*` no `.env.local` ignorado pelo Git. Informe e-mails e senhas somente nesse arquivo; nunca coloque a chave administrativa em variáveis `VITE_*`. O repositório não publica nem acompanha senhas. Após cada reset local, execute novamente o script para recriar as identidades Auth.

## Jornada SR1

Depois do login, a aplicação restaura o contexto autorizado pela tabela `vinculos`. A conta `area_tecnica` pode enviar uma entrada para `DEMO-01`; a conta CAM consulta o histórico no seu escopo, mas não envia. A tela identifica competência, indicador e escopo sintéticos e deixa explícito que a regra é demonstrativa.

O navegador envia o valor como texto à RPC `submit_demo_entry`; validação, cálculo, memória e auditoria acontecem no servidor local. A interface exibe o valor de resultado retornado e recarrega o histórico persistido. Em caso de falha de rede, a tentativa mantém o mesmo UUID de operação para permitir reenvio idempotente.

## E2E da jornada SR1

Com Supabase local ativo e as duas contas fictícias preparadas, forneça ao processo de teste somente `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `DEMO_TECHNICAL_EMAIL`, `DEMO_TECHNICAL_PASSWORD`, `DEMO_CAM_EMAIL` e `DEMO_CAM_PASSWORD`. Essas variáveis devem apontar para a instância local e não devem ser gravadas no Git. Em seguida, execute:

```sh
npx playwright test sr1-flow.spec.ts
```

O fluxo cobre envio `10 → 8`, consulta após recarga, recusa CAM no banco e na interface, rejeição server-side de campo vazio/texto, sessão expirada e retry com o mesmo identificador depois de perda da resposta.

## Banco de dados local

Use o comando abaixo somente com a instância local iniciada por `npx supabase start`. Ele recria o banco local a partir das migrations e seeds deste repositório:

```sh
npx supabase db reset
```

O teste de banco também usa o Supabase local e pgTAP:

```sh
npm run db:test
```

## Verificações

```sh
npm test -- --run
npm run lint
npm run typecheck
npm run build
npx playwright test smoke.spec.ts
npx playwright test sr1-flow.spec.ts
```
