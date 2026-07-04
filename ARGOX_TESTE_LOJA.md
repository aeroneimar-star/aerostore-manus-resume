# Argox OS-214 — teste na loja (PC local)

Guia para levar o projeto do PC de casa para o **PC da loja** e testar impressão de etiquetas com segurança.

O layout **PPLB 40x60** (AEROSTORE, DE/POR, barcode, 2 colunas) já foi validado em dry-run. Este guia **não recalibra layout** — só operação e integração.

---

## Arquitetura (resumo)

```
Browser (PDV /pdv/produtos)
    → server.js :3000  (/api/pdv/labels/print → gera agent_payload PPLB)
    → agente-impressao-argox :4000  (GET /status, POST /imprimir)
    → Windows Print Spooler (RAW)
    → Argox OS-214 Plus
```

---

## Arquivos da entrega Argox

| Caminho | Função |
|---------|--------|
| `agente-impressao-argox/server.js` | Agente HTTP local (porta 4000) |
| `agente-impressao-argox/package.json` | Dependência `@thiagoelg/node-printer` |
| `agente-impressao-argox/.env.example` | Variáveis do agente na loja |
| `agente-impressao-argox/output/` | `.prn` salvos em **dry-run** (não versionar conteúdo) |
| `modules/pdv/services/argoxPplbGenerator.js` | Gerador PPLB (layout validado) |
| `modules/pdv/services/pdvLabelPrintService.js` | API labels + `agent_payload` |
| `modules/pdv/routes/pdvLabelRoutes.js` | Rotas `/api/pdv/labels/*` |
| `public/app.js` | Drawer etiqueta → chama `localhost:4000` |
| `.env.example` | `ARGOX_LABEL_LANGUAGE=PPLB`, `ARGOX_AGENT_URL`, etc. |
| `scripts/pdv_argox_pplb_smoke.js` | Smoke do gerador PPLB |
| `scripts/test_argox_agent_dry_run.js` | Teste integrado do agente (sobe/valida/encerra) |
| `scripts/test_argox_at_home.js` | Gera `.prn` de exemplo em `tmp/labels/` |
| `scripts/windows/send-argox-raw.ps1` | Fallback manual RAW (opcional) |

**Não precisa copiar manualmente** se o PC da loja usar o mesmo repositório Git: `git pull` traz tudo acima (após commit/push do PC de casa).

---

## Antes de ir para a loja (PC de casa)

### 1. Confirmar testes automáticos

```powershell
cd C:\CAMINHO\DO\PROJETO
node scripts/pdv_argox_pplb_smoke.js
node scripts/test_argox_agent_dry_run.js
```

Ambos devem terminar sem erro.

### 2. Commit e push (recomendado)

No PC de casa, versionar os arquivos Argox novos/alterados e enviar ao remoto:

```powershell
git status
git add agente-impressao-argox modules/pdv/services/argoxPplbGenerator.js modules/pdv/services/pdvLabelPrintService.js public/app.js .env.example .gitignore scripts/pdv_argox_pplb_smoke.js scripts/test_argox_at_home.js scripts/test_argox_agent_dry_run.js ARGOX_TESTE_LOJA.md
git commit -m "Argox PPLB: agente local, integração PDV e guia de teste na loja"
git push
```

No PC da loja:

```powershell
cd C:\CAMINHO\DO\PROJETO
git pull
```

Se não usar Git na loja, copie a pasta do projeto inteira (incluindo `agente-impressao-argox` e `modules/pdv/services/argoxPplbGenerator.js`).

### 3. `.env` do projeto (raiz)

No PC da loja, no `.env` principal:

```env
ARGOX_LABEL_LANGUAGE=PPLB
ARGOX_AGENT_URL=http://localhost:4000
ARGOX_PRINTER_NAME=Argox OS-214plus
ARGOX_LABEL_WIDTH_MM=40
ARGOX_LABEL_HEIGHT_MM=60
ARGOX_LABEL_COLUMNS=2
ARGOX_DEFAULT_TEMPLATE=aerostore_tag_40x60_2c
```

Ajuste `ARGOX_PRINTER_NAME` para o **nome exato** da fila no Windows (Painel de Controle → Dispositivos e Impressoras).

---

## Preparar o PC da loja (uma vez)

### Driver e impressora Windows

1. Instalar driver **Argox OS-214 Plus** (ou fila que aceite RAW/PPLB).
2. Anotar o nome da impressora no Windows (ex.: `Argox OS-214plus`).
3. **Não usar Zadig / WinUSB** — o agente usa o spooler normal.

### Dependências Node

```powershell
cd C:\CAMINHO\DO\PROJETO
npm install

cd agente-impressao-argox
npm install
```

`npm install` no agente é **obrigatório para impressão real** (`@thiagoelg/node-printer`). Em dry-run pode funcionar sem instalar.

---

## Teste 1 — Simulado (seguro, sem papel)

Use primeiro na loja para validar PDV + agente **sem gastar etiqueta**.

### Terminal 1 — PDV

```powershell
cd C:\CAMINHO\DO\PROJETO
node server.js
```

Aguarde: servidor em `http://localhost:3000`.

### Terminal 2 — Agente Argox em simulado

```powershell
cd C:\CAMINHO\DO\PROJETO\agente-impressao-argox
$env:ARGOX_AGENT_DRY_RUN="true"
node server.js
```

Deve aparecer: `Modo: SIMULADO (sem impressora)`.

### Testar status

```powershell
curl http://localhost:4000/status
```

Resposta esperada:

```json
{
  "status": "online",
  "conectada": true,
  "dry_run": true,
  "impressora": "SIMULADO (sem impressora)",
  "linguagem": "PPLB"
}
```

### Testar pelo PDV

1. Abrir `http://localhost:3000/pdv/produtos`
2. Login (ex.: `admin@aerostore.local`)
3. Produto → **Etiqueta** → **Imprimir etiqueta**
4. Drawer deve mostrar **simulado (sem impressora)**
5. Sucesso → arquivo em `agente-impressao-argox\output\dry-run-*.prn`

Abra o `.prn` no Bloco de Notas e confira textos (AEROSTORE, DE/POR, barcode).

---

## Teste 2 — Impressão real na Argox

Só faça depois do Teste 1 OK e com **etiquetas na impressora**.

### 1. Parar o agente simulado

No Terminal 2: **Ctrl+C**.

### 2. Desligar dry-run

No PowerShell do agente:

```powershell
$env:ARGOX_AGENT_DRY_RUN="false"
$env:ARGOX_PRINTER_NAME="Argox OS-214plus"
```

Substitua pelo nome **exato** da sua fila Windows.

Opcional: criar `agente-impressao-argox\.env` a partir de `.env.example` com `ARGOX_AGENT_DRY_RUN=false`.

**Importante:** se `ARGOX_AGENT_DRY_RUN` ficar `true` na loja, **nada imprime** — só gera arquivo em `output/`.

### 3. Subir agente em modo real

```powershell
cd C:\CAMINHO\DO\PROJETO\agente-impressao-argox
npm install
node server.js
```

Deve aparecer: `Modo: IMPRESSAO REAL` e o nome da impressora detectada.

### 4. Validar `/status` antes de imprimir

```powershell
curl http://localhost:4000/status
```

Checklist **obrigatório**:

| Campo | Valor esperado |
|-------|----------------|
| `conectada` | `true` |
| `dry_run` | `false` |
| `impressora` | Nome real da Argox (não "SIMULADO") |

Se `conectada: false`, **não imprima** — corrija driver/nome da fila primeiro.

### 5. Imprimir 1 etiqueta teste

1. PDV → produto → **Etiqueta**
2. Quantidade: **1** (primeiro teste)
3. **Imprimir etiqueta**
4. Verificar saída física e alinhamento

Se layout estiver certo (já validado em dry-run), problema costuma ser calibração mecânica/driver — não refazer PPLB sem necessidade.

### 6. Onde aparece o `.prn` em modo real

Em **impressão real**, o agente **não salva** `.prn` em `output/` — envia direto ao spooler.

Fallback PRN do PDV (se agente falhar): `tmp/labels/` + botão **Baixar arquivo PRN** no drawer.

---

## Parar os servidores

Em cada terminal: **Ctrl+C**.

Para conferir se a porta 4000 ficou livre:

```powershell
netstat -ano | findstr :4000
```

Se ainda houver processo, encerre pelo Gerenciador de Tarefas ou:

```powershell
taskkill /PID NUMERO_DO_PID /F
```

---

## Erros comuns

| Sintoma | Causa provável | O que fazer |
|---------|----------------|-------------|
| Drawer: "Agente Argox offline" | Agente não está rodando | Subir Terminal 2 (`node server.js` em `agente-impressao-argox`) |
| `curl :4000` falha | Porta ocupada ou firewall | `netstat -ano \| findstr :4000`; matar processo ou mudar `ARGOX_AGENT_PORT` |
| CORS / fetch bloqueado | Origem diferente de localhost | Acessar PDV via `http://localhost:3000`; ou setar `ARGOX_AGENT_ORIGINS` no agente |
| `conectada: false`, dry_run false | Impressora não encontrada | Conferir nome no Windows; setar `ARGOX_PRINTER_NAME` exato |
| Impressão não sai, dry_run true | Modo simulado ligado | `$env:ARGOX_AGENT_DRY_RUN="false"` e reiniciar agente |
| `node-printer indisponivel` | `npm install` não rodou no agente | `cd agente-impressao-argox && npm install` |
| Sucesso no PDV mas papel em branco | Fila/driver errado ou RAW não aceito | Testar mesma fila com `scripts/windows/send-argox-raw.ps1` e um `.prn` de `output/` |
| PRN OK, Argox não | Cabo/USB, tampa, sem papel | Fila de impressão do Windows mostra o erro |

---

## Comandos rápidos (cola na loja)

```powershell
# Testes automáticos (sem deixar servidor aberto)
node scripts/pdv_argox_pplb_smoke.js
node scripts/test_argox_agent_dry_run.js

# PDV
cd C:\CAMINHO\DO\PROJETO
node server.js

# Agente simulado
cd C:\CAMINHO\DO\PROJETO\agente-impressao-argox
$env:ARGOX_AGENT_DRY_RUN="true"
node server.js

# Status
curl http://localhost:4000/status

# Agente real (depois do simulado OK)
$env:ARGOX_AGENT_DRY_RUN="false"
$env:ARGOX_PRINTER_NAME="Argox OS-214plus"
node server.js
```

Substitua `C:\CAMINHO\DO\PROJETO` pelo caminho real (ex.: `C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado`).

---

## Checklist final na loja

- [ ] `git pull` (ou pasta copiada) com `agente-impressao-argox` e `argoxPplbGenerator.js`
- [ ] `npm install` na raiz e em `agente-impressao-argox`
- [ ] `.env` com `ARGOX_LABEL_LANGUAGE=PPLB`
- [ ] Teste simulado: `/status` → `dry_run: true` → `.prn` em `output/`
- [ ] Teste real: `/status` → `dry_run: false` + impressora detectada
- [ ] 1 etiqueta física de teste antes de lote grande

---

## Suporte

Se impressão real falhar mas dry-run e `.prn` estiverem corretos, o problema é **ambiente Windows/impressora**, não o layout PPLB. Envie:

1. Saída de `curl http://localhost:4000/status`
2. Nome exato da impressora no Windows
3. Foto da etiqueta impressa (se sair algo)
