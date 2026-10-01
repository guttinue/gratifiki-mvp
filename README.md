# Gratifiki MVP local

Este repositório contém um MVP acadêmico executado localmente. A aplicação consulta somente o contexto sintético autorizado da instância Supabase local; ela não usa dados nem serviços da SESAU e não declara validação institucional.

## Requisitos

- Node.js 22.12 ou superior e npm.
- Docker Desktop, OrbStack ou runtime compatível com a API do Docker, com o daemon ativo.
- O Supabase CLI usado pelo projeto já vem nas dependências; não é necessário instalá-lo globalmente.

## Abrir a aplicação

Instale as dependências uma vez e inicie os serviços locais:

```sh
npm ci
npx supabase start
```

Copie `.env.example` para `.env.local` e configure os valores que o ambiente local exibir para `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`. Use somente o endpoint de loopback local. Não coloque chave `service_role`, senha ou outra chave secreta em variável `VITE_*`. O arquivo `.env.local` é privado e não deve ser enviado ao Git.

Inicie a interface:

```sh
npm run dev -- --host 127.0.0.1 --port 5173
```

Abra [http://127.0.0.1:5173](http://127.0.0.1:5173). O ambiente local mostra a tela de login, sem fornecer credenciais fictícias. Depois da autenticação, o perfil e o escopo vêm do vínculo autorizado da sessão.

## Perfis e páginas

- **Área técnica:** consulta o contexto do piloto e envia valores para `DEMO-01`.
- **CAM · leitura:** consulta os registros autorizados, sem formulário nem ações de escrita.
- **Visão geral (`#overview`):** conta entradas, resultados persistidos, pendências e eventos de auditoria visíveis no escopo.
- **Entradas (`#entries`):** busca e filtra registros, envia valores como área técnica e abre o detalhe persistido.
- **Histórico e auditoria (`#history`):** consulta eventos de envio e o detalhe que liga entrada, resultado e evento.

O cálculo do piloto é sintético. O estado `pendente` não significa aprovação, e a interface não implementa aprovação, devolução, correção, fechamento, exportação ou efeito financeiro institucional. Resultados e horários são lidos do que foi persistido; a tela não recalcula valores nem inventa datas de criação.

## Contas locais de demonstração

O comando `npm run demo:users` cria duas identidades locais: `area_tecnica` e `cam`, vinculadas ao escopo fictício do piloto. Configure no `.env.local` `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` local e as variáveis `DEMO_TECHNICAL_EMAIL`, `DEMO_TECHNICAL_PASSWORD`, `DEMO_CAM_EMAIL` e `DEMO_CAM_PASSWORD`. O script lê esse arquivo localmente; informe senhas somente nele. A chave administrativa nunca deve estar em variável `VITE_*`.

Execute a criação de contas após iniciar o Supabase pela primeira vez ou quando precisar recriar as identidades. Não é necessário resetar o banco para usar a aplicação.

## Testes E2E e pgTAP locais

Os E2E usam credenciais do processo, conferem que o Supabase está em loopback antes de autenticar e rodam o Vite de teste na porta `4173` (a aplicação aberta para uso continua na `5173`). Use um worker para evitar disputa entre testes de contagens. O invocador abaixo carrega `.env.local` em memória e substitui valores privados da saída antes de exibi-los; ele executa E2E e pgTAP sem resetar o banco:

```sh
run_local() {
  node --env-file=.env.local -e '
    const { spawnSync } = require("node:child_process");
    const env = { ...process.env };
    delete env.NO_COLOR;
    const result = spawnSync("npm", process.argv.slice(1), { encoding: "utf8", env, maxBuffer: 8 * 1024 * 1024 });
    const privateValues = Object.entries(env)
      .filter(([name, value]) => value && /PASSWORD|KEY|TOKEN|SECRET|EMAIL/i.test(name))
      .map(([, value]) => value);
    const redact = (output = "") => privateValues.reduce((safe, value) => safe.replaceAll(value, "[redacted]"), output);
    process.stdout.write(redact(result.stdout ?? ""));
    process.stderr.write(redact(result.stderr ?? ""));
    process.exit(result.status ?? 1);
  ' -- "$@"
}

run_local run test:e2e -- --workers=1
run_local run db:test
```

A prova cobre envio `10 → 8` e `0 → 0`, detalhe e memória persistidos, métricas relativas, histórico, CAM somente leitura e negação na RPC, valores inválidos antes da RPC e na validação do servidor, sessão expirada, retry idempotente após resposta perdida, navegação durante envio, logout durante consulta atrasada, filtros, navegação por hash, erro de carregamento e larguras de 1440, 390 e 320 pixels. As gravações E2E são sintéticas e permanecem na instância local; os testes não apagam entradas.

Os testes pgTAP usam transações com rollback e comparam acessos e gravações à linha de base capturada no início. Assim podem rodar sobre a instância já preenchida, preservando os dados existentes. Não rode `npx supabase db reset` apenas para iniciar a aplicação ou repetir E2E/pgTAP: esse comando recria o banco local e remove os registros atuais.

## Parar os serviços e preservar os volumes

Quando terminar, pressione `Ctrl+C` no terminal em que `npm run dev` está rodando. Depois, pare os contêineres locais:

```sh
npx supabase stop
```

Esse comando mantém os volumes e os dados locais para a próxima execução. Não use `--no-backup`: essa opção exclui os volumes de dados.

Você também pode fechar o Docker Desktop depois de parar o Supabase se nenhum outro projeto local estiver usando contêineres.

## Outras verificações

```sh
npm test -- --run
npm run lint
npm run typecheck
npm run build
```
