# Gratifiki MVP local

Este repositório contém o MVP acadêmico sintético React/Vite/TypeScript + Supabase-first. Sete jornadas autenticadas usam um indicador `DEMO-01`; não é a gratificação institucional integral, não usa dados/serviços SESAU e não declara aceite institucional. A baseline histórica de dois papéis continua identificada como legado.

## Estado do projeto — telas V4 na main (17/11/2026)

As telas seguem o Protótipo V4 desde 17/11/2026 (PR #2). O modelo 3 (V3) está implementado de ponta a ponta, com dados sintéticos e regra fictícia **DEMO-v1**. Não há implantação remota, homologação SESAU nem efeito institucional.

- **Quatro indicadores DEMO** (`DEMO-V1-01` a `DEMO-V1-04`, pesos 30/25/25/20) formam o conjunto de regras DEMO-v1, tratado como `zero` quando falta valor. Quatro unidades (Alfa e Beta no Distrito Norte; Gama e Delta no Distrito Sul) e dois meses (`ACADEMIC-V3-2026-09`, fechado e publicado; `ACADEMIC-V3-2026-10`, aberto) vêm do bootstrap.
- **Modelo 3, fluxo:** a área técnica preenche e envia a unidade em lote (tudo ou nada), com prévia de pontos; o revisor aceita ou devolve um item por vez; a CAM decide indisponibilidade e não aplicação, consolida, fecha e publica com referência `DEMO-DECISAO-…`/`DEMO-PUBLICACAO-…`; o gestor vê nota, comparação com o mês anterior e “Como foi calculado?”; a liderança vê médias por distrito; o CSV (contrato 2) traz `valor`, `meta`, `peso`, `peso_efetivo` e `pontos`.
- **Modelo 2 inalterado:** o indicador legado `DEMO-01`, as sete jornadas e as suítes anteriores continuam verdes. Uma mesma sessão pode ter contextos dos dois modelos.
- **Continua fora:** regras e indicadores oficiais da portaria, retificação após o fechamento no modelo 3, e qualquer tela ou comando para criar ou editar regras (o cadastro de regras é só por migração ou seed). ML não participa do cálculo.
- **Verificação em 03/11/2026, após a rodada final de correções** (ver `Output/gratifiki-mvp/sistema-completo-v3/2026-11-02/relatorio.md`): 727 testes unitários em 60 arquivos; 1053 verificações pgTAP em 25 arquivos; 64 E2E em 21 arquivos (inclui `tests/e2e/academic-v3-journey.spec.ts`, a jornada V3 completa); typecheck, lint e build limpos; `npm run verify:restore` sai com 0 sobre o esquema atual.
- **Pendente:** revisão da rodada final de correções, execução hospedada do CI e teste com usuários.

## Estado anterior — trabalho em desenvolvimento (24/10/2026, histórico)

As 16 tarefas de implementação tiveram aceite individual; a revisão integrada exige quatro correções antes do aceite final:

- Limpar o conteúdo já carregado quando o acesso for inequivocamente revogado.
- Permitir que a CAM alcance posições e bloqueadores além dos primeiros 25 alvos.
- Preservar edição não salva durante uma renovação válida de sessão.
- Corrigir a repetição do bootstrap depois do fechamento do ciclo. Até lá, não repetir esse preparo após fechar nem resetar banco para contornar a falha.

O evento de exportação é persistido, mas sua consulta na auditoria ainda tem uma melhoria menor pendente. Os resultados históricos de 23/10 (444 testes unitários, 727 verificações SQL e 54 E2E) são anteriores às correções acima, não provas de resolução. O código é um MVP acadêmico local, sem implantação remota ou homologação SESAU. Sete perfis não significam cinco indicadores oficiais: o ciclo implementado usa somente `DEMO-01` sintético. ML continua assistivo/offline, sem modelo validado e fora do cálculo.

Este repositório privado preserva a versão em desenvolvimento; não contém credenciais locais, banco, dumps ou dados institucionais. A publicação do código não inicia os serviços locais nem autoriza implantar o sistema. O ambiente manual existente permanece desligado, com dados preservados. GitHub Actions está inicialmente desativado no repositório; o workflow foi preparado, mas sua execução hospedada não é evidência já obtida.

## Requisitos

- Node.js 22.12 ou superior e npm.
- Docker Desktop, OrbStack ou runtime compatível com a API do Docker, com o daemon ativo.
- O Supabase CLI usado pelo projeto já vem nas dependências; não é necessário instalá-lo globalmente.

## Rodar o MVP (telas V4)

Este é o único caminho para ver as telas atuais, no estilo V4. Use um terminal **bash** a partir da pasta do repositório, com o Docker já aberto. Cada bloco abaixo assume a mesma janela de terminal.

### 1. Banco local (uma vez)

```bash
npm ci
npx supabase start
npx supabase migration up --local
docker exec -i supabase_db_gratifiki-mvp-local psql -q -1 -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/seed.sql
```

Se o banco já existia, o `migration up` aplica só o que falta, sem apagar dados.

### 2. Contas fictícias (uma vez)

O bloco cria sete contas fictícias, uma por papel, com senhas aleatórias. Os e-mails e as senhas ficam em `.verification/demo/credentials.env`, pasta que o Git ignora. Não compartilhe esse arquivo.

```bash
mkdir -p .verification/demo && umask 077
for r in AREA_TECNICA REVISOR_TECNICO CAM GESTOR_UNIDADE GESTOR_DISTRITAL ADMINISTRADOR LIDERANCA; do
  l=$(echo $r | tr 'A-Z_' 'a-z-')
  echo "ACADEMIC_${r}_EMAIL=${l}@gratifiki-demo.invalid"
  echo "ACADEMIC_${r}_PASSWORD=$(openssl rand -hex 12)"
done > .verification/demo/credentials.env
npx supabase status -o env > .verification/demo/status.env
set -a; . .verification/demo/credentials.env; . .verification/demo/status.env; set +a
SUPABASE_URL="$API_URL" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" npm run demo:academic
```

O comando termina com `Academic synthetic bootstrap complete`. Não rode este passo de novo depois de fechar um ciclo na interface, porque a repetição após o fechamento ainda tem uma falha conhecida.

### 3. Interface

```bash
set -a; . .verification/demo/status.env; set +a
VITE_SUPABASE_URL="$API_URL" VITE_SUPABASE_PUBLISHABLE_KEY="$PUBLISHABLE_KEY" VITE_RUNTIME_MODE=local \
  npm run dev -- --host 127.0.0.1 --port 5173
```

Abra [http://127.0.0.1:5173](http://127.0.0.1:5173) e entre com um dos e-mails de `.verification/demo/credentials.env`. Cada papel abre as próprias telas:

- **Área técnica:** preenche e envia a unidade.
- **Revisor técnico:** confere e aceita ou devolve cada item.
- **CAM:** decide pendências, fecha e publica o mês.
- **Gestor de unidade e gestor distrital:** veem a nota e como ela foi calculada.
- **Liderança:** vê médias por distrito.
- **Administrador:** cuida de vínculos e configurações.

As contas antigas do piloto (`npm run demo:users`) abrem o painel legado, com o visual anterior. Não as use para ver o MVP.

Nas próximas vezes, basta rodar `npx supabase start` e o passo 3.

## Regras de acesso

O seletor mostra contextos descobertos pelo servidor, nunca papéis livres. RPC/grants/RLS decidem autorização, transição e cálculo exato no banco. Zero, ausência, indisponibilidade e não aplicação são diferentes. Snapshot não é pagamento e publicação é explicitamente de demonstração. ML não participa do cálculo. O cliente rejeita URL remota no modo local e chaves administrativas em qualquer modo. Não coloque `service_role`, `sb_secret_*`, senha ou segredo em `VITE_*`; esse prefixo é público. O cadastro público é negado em Auth (`enable_signup=false`).

## Verificação isolada: E2E e pgTAP

O gate acadêmico usa uma instância **descartável própria**, sem ler ou copiar `.env.local`, sem reutilizar o Vite aberto e sem reinicializar o banco de uso:

```sh
npm run verify:isolated -- --suite all --fixture academic
npm run verify:isolated -- --suite db --fixture academic
npm run verify:restore
```

Sem `--file`, roda toda a suíte escolhida; com arquivo, ele deve pertencer a `supabase/tests/database/` ou `tests/e2e/`. `academic` inclui bootstrap atual e regressão legada; `legacy` permanece disponível. Docker deve estar ativo e Chromium do Playwright instalado (`npx playwright install chromium`). Cada arquivo E2E usa projeto novo, sequencialmente; não depende de rollback/estado de outro arquivo.

Cada execução cria um diretório temporário com marcador privado e `project_id` único. Copia apenas migrações, testes SQL e seed públicos, inicia os serviços mínimos, aplica `migration up --local` explicitamente, executa o seed sintético e provisiona credenciais fictícias somente em memória. API/DB/shadow usam `55421`/`55422`/`55420`; o Vite isolado usa `4175` e um worker. Porta ocupada causa falha, sem interromper o processo que a utiliza. Não rode duas verificações isoladas simultaneamente. Execute `npm test` antes ou depois do gate, não em paralelo: os testes de segurança do executor também conferem essas portas.

A saída redige chaves, senhas e conexões; traces de navegador ficam desligados. Ao concluir ou receber Ctrl+C, a rotina remove somente os contêineres/volumes/redes desse projeto descartável e verifica a limpeza. Se ela falhar, informa o identificador e preserva o marcador temporário para diagnóstico. Encerramento forçado pelo sistema pode exigir limpeza manual **apenas do identificador informado**. Nunca use `stop --all`.

## Recuperação e CI

`verify:restore` não aceita argumentos/URL/diretório arbitrário. Cria source em 55420–55422 e target em 55520–55522, ambos `OwnedTarget` marcados e validados. Exercita migrações reais préT11/préT13, dump custom de negócio/private/Auth/histórico de migrações e restaura em segundo projeto vazio, conservando owners/grants/RLS/policies. Usa somente role base local existente `supabase_admin` para restaurar ownership Auth; não concede privilégios ao app. Compara todas as tabelas por contagem/checksum e permissões efetivas, então verifica login original dos sete papéis, memória, decisões, snapshot publicado, exportação e acesso negado.

O dump contém credenciais **fictícias** e vive apenas em subdiretório temporário 0700/arquivo0600 do projeto proprietário. Não copiar para Output, Drive, Git, logs ou artifacts de CI; ele é removido na limpeza guardada. A recuperação não inclui objetos Storage/anexos, ausentes do corte. Não mede SLA/RPO/RTO de produção. Nunca execute outro runner/unitário sobre as portas enquanto o gate está ativo.

O suplemento real de23/10/2026 também compara `pg_default_acl`: defaults globais implícitos/explícitos por role/tipo, templates por schema e ACL efetiva, com grantor/grantee/grantable. Como pg_dump por schema não captura o template global adicional da fixture, o backup inclui `default-acl.json` privado junto ao arquivo binário. A restauração reconstrói exatamente o template fonte (global antes de schema), com privilégios individuais validados e grantor original, sem novos roles ou GRANT ALL; igualdade integral é conferida depois. Controles negativos separados detectaram drift global e grant-option do schema, sem regrant antes do descarte. O gap anterior está fechado por essa prova nova, não pelo GREEN histórico. Gates finais23/10:444unitários,727pgTAP+concorrências e54E2E/18arquivos production-preview, allJSONfinal/exit0; restore completo/cleanup passou. Revisão independente/integrada permanecem pendentes; T16 não tem aceite automático e o CI hospedado não foi executado.

O workflow `.github/workflows/academic-ci.yml` instala pelo lockfile e executa os mesmos gates em runner descartável, sem secrets remotos/deploy/upload de dump. O arquivo de CI foi preparado localmente; execução hospedada depende de commit/push autorizados e não é presumida.

## Preparo remoto (sem publicação)

`demo_remote` exige HTTPS e hostname API exato em `VITE_ALLOWED_DEMO_HOSTS`; o modo é público, não autorização. Não usar wildcard ou domínio do site institucional. Antes de qualquer deploy: autorização explícita com provedor/plano/custo/região, projeto próprio do MVP, Auth sem signup, origem/redirects exatos HTTPS sem wildcard amplo, contas fictícias por canal protegido, migrações, smoke positivo/negativo nos sete papéis e recuperação adequada ao destino. Bootstrap e restore entregues continuam local-only; não oferecem atalho remoto. AC24 permanece **preparo técnico / publicação pendente**, sem uso SESAU.

A baseline cobre envio `10 → 8` e `0 → 0`, memória persistida, métricas, histórico, CAM sem escrita, validação, sessão expirada, retry idempotente, navegação, filtros e larguras 1440/390/320. Os registros sintéticos do gate são descartados; os registros da instância de uso permanecem intocados. Os comandos antigos `test:e2e` e `db:test` continuam disponíveis para uso manual explícito, mas não substituem o gate isolado.

Não rode `npx supabase db reset` para iniciar a aplicação ou repetir testes: esse comando remove os registros do banco local de uso.

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
