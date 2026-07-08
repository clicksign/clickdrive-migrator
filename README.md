# clickdrive-migrator

Migrador de documentos: envia arquivos e pastas de um caminho local para o Click.Drive via CLI, preservando a estrutura de pastas e tratando duplicidades automaticamente.

## Pré-requisitos

O script requer **Node.js 18 ou superior** (inclui o `npm`). Ele funciona da mesma forma em Windows, macOS e Linux.

| Sistema | Como instalar |
|---|---|
| Windows | Baixe o instalador LTS em [nodejs.org](https://nodejs.org/) e execute-o, ou instale via [nvm-windows](https://github.com/coreybutler/nvm-windows). |
| macOS | `brew install node` (via [Homebrew](https://brew.sh/)), ou baixe o instalador LTS em [nodejs.org](https://nodejs.org/). |
| Linux | Use o gerenciador de pacotes da distro (ex: `sudo apt install nodejs npm` no Ubuntu/Debian) ou, para ter controle de versão, o [nvm](https://github.com/nvm-sh/nvm). |

Para confirmar a instalação:

```bash
node --version
npm --version
```

## Instalação

```bash
git clone <url-deste-repositorio>
cd clickdrive-migrator
npm install
```

## Configuração

Copie o arquivo de exemplo e preencha com as credenciais da sua conta:

```bash
# Linux, macOS, Git Bash ou WSL
cp .env.example .env
```

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```

```cmd
 Windows (cmd.exe)
copy .env.example .env
```

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `CLICKDRIVE_API_URL` | Sim | — | URL base da api-clickdrive (ex: `http://localhost:8080`) |
| `CLICKDRIVE_TOKEN` | Sim | — | Token de sessão do Tavola, sem o prefixo `Bearer` |
| `CLICKDRIVE_CONCURRENCY` | Não | `4` | Máximo de requisições (upload/criação de pasta) em paralelo |
| `CLICKDRIVE_MAX_RETRIES` | Não | `3` | Tentativas extras em erros transitórios (5xx, timeout, rede) |
| `CLICKDRIVE_RETRY_BASE_MS` | Não | `500` | Atraso base (ms) do backoff exponencial entre tentativas |
| `CLICKDRIVE_REQUEST_TIMEOUT_MS` | Não | `30000` | Tempo máximo (ms) de espera por uma requisição antes de considerá-la falha (conta como erro transitório, reenviada com backoff) |
| `CLICKDRIVE_RESET_STATE` | Não | `false` | Se `true`, ignora o checkpoint de retomada e migra tudo do zero |

### Retomada de migrações interrompidas

A cada pasta criada ou arquivo enviado com sucesso, o script grava um checkpoint em `./.clickdrive-migrator-state/<hash-do-caminho>.jsonl` (um arquivo por caminho migrado). Se a execução for interrompida — queda de energia, perda de rede, `Ctrl+C` — basta rodar o **mesmo comando novamente**: tudo que já foi migrado com sucesso é reconhecido pelo checkpoint e pulado (sem nova chamada à API), e a migração continua apenas nos itens pendentes.

Esse checkpoint é local ao script (não é uma consulta à ClickDrive, que não expõe busca por nome), então ele só sabe o que **este** processo já migrou. Um conflito de nome com algo que já existia na ClickDrive antes, ou criado por outra via, continua caindo no fluxo de duplicidade descrito abaixo.

Para forçar uma migração do zero, ignorando qualquer checkpoint existente, defina `CLICKDRIVE_RESET_STATE=true` ou apague o arquivo correspondente em `.clickdrive-migrator-state/`.

### Migrações com muitos arquivos

Para não sobrecarregar a api-clickdrive em migrações grandes, os uploads e criações de pasta respeitam um limite de concorrência (`CLICKDRIVE_CONCURRENCY`, padrão 4 requisições simultâneas) e falhas transitórias (erros `5xx`, timeout ou de rede) são reenviadas automaticamente com backoff exponencial (`CLICKDRIVE_MAX_RETRIES` tentativas, começando em `CLICKDRIVE_RETRY_BASE_MS`). Erros definitivos (`401`, `403`, `404`, `409`, `413`, `422`) não são reenviados, `409` segue o fluxo de duplicidade descrito abaixo, os demais contam como falha.

### Como obter o `CLICKDRIVE_TOKEN`

Se você já tem um token criado para esta integração, apenas copie e cole o valor em `CLICKDRIVE_TOKEN`. Caso ainda não tenha um, gere um novo:

1. **Gere um Access Token**
   - Faça login na sua conta.
   - Vá em **Configurações** e depois em **API**.
   - Clique em **Gerar Access Token**.
   - Preencha uma descrição e clique em **Gerar**.
   - Copie e guarde o token.

   ![Tela de geração do Access Token](docs/images/gerar-access-token-1.png)

2. **Associe o usuário à API**
   - Na mesma tela onde o token foi gerado, associe seu e-mail à API e clique em **Salvar e-mail**.

   ![Tela de associação do e-mail do usuário da API](docs/images/gerar-access-token-2.png)

## Uso

```bash
node script-main.js "./caminho-para-pasta/arquivo.doc"
node script-main.js "/home/usuario/financeiro"
```

- Se o caminho informado for um **arquivo**, ele é enviado diretamente para a raiz do workspace no Click.Drive.
- Se o caminho informado for uma **pasta**, o script cria essa pasta na raiz do workspace e replica toda a árvore de subpastas e arquivos dentro dela, criando cada pasta necessária antes de enviar seus arquivos.

### Duplicidade

Quando a api-clickdrive responde `409 Conflict` (já existe um arquivo ou pasta com o mesmo nome naquele local), o script **não** tenta reenviar o item para o Click.Drive. Em vez disso, ele move o arquivo (ou a pasta inteira, com seu conteúdo) para uma subpasta `duplicated` criada **no próprio caminho local**, ao lado do item original, e segue migrando o restante normalmente.

Exemplo: se `/home/usuario/financeiro/contratos/contrato1.txt` conflitar no Click.Drive, o arquivo é movido localmente para `/home/usuario/financeiro/contratos/duplicated/contrato1.txt`.

O nome `duplicated` é reservado pelo script em qualquer nível da árvore migrada: se você já tiver uma pasta com esse nome (criada por você, não pelo script), ela é **inteiramente ignorada na migração** — sem aviso no console, sem contar como falha nas estatísticas finais. Como essa exclusão acontece na leitura da árvore local, `CLICKDRIVE_RESET_STATE=true` não resolve o caso, já que ele só limpa o checkpoint de retomada, não muda quais pastas são consideradas na travessia. Se você tiver uma pasta `duplicated` legítima, renomeie-a antes de migrar.

### Symlinks

Links simbólicos (arquivos ou pastas) encontrados na árvore migrada não são enviados ao Click.Drive — o script registra um aviso (`warn`) no log para cada um encontrado, mas o conteúdo do link não é migrado.

### Logs

Cada execução grava um arquivo em `logs/migration-<timestamp>.log` com todos os arquivos processados, pastas criadas, uploads concluídos e falhas, além de exibir o mesmo conteúdo no console.

### Códigos de saída

| Código | Significado |
|---|---|
| `0` | Migração concluída sem falhas |
| `1` | Uso inválido, configuração ausente, caminho inexistente ou pelo menos uma falha durante a migração |

