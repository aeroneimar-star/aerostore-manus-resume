# Argox OS-214 — teste na loja (PC local)

Guia para levar o projeto do PC de casa para o **PC da loja** e testar impressão de etiquetas com segurança.

O layout **40x60** (AEROSTORE, DE/POR, barcode, 2 colunas) já foi validado em dry-run. Este guia **não recalibra layout** — só operação, captura de PRN oficial, transporte RAW e integração.

> **Prioridade atual:** nesta OS-214, RAW direto nao e confiavel. Use **`ARGOX_PRINT_TRANSPORT=WINDOWS_DRIVER`** (bitmap via driver normal). RAW permanece disponivel como opcao.

---

## Transporte WINDOWS_DRIVER (recomendado nesta instalacao)

### Por que

- Pagina de teste Windows **imprime**
- Jobs RAW (PPLA/PPLB) sao aceitos pelo spooler mas **nao imprimem**
- Captura via porta FILE: nao e desejada (bagunca USB)

### Config

**Agente (PowerShell):**
```powershell
$env:ARGOX_PRINT_TRANSPORT="WINDOWS_DRIVER"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
$env:ARGOX_SAFE_TEST_MODE="true"
$env:ARGOX_AGENT_DRY_RUN="false"
node server.js
```

**Status esperado:**
```json
{
  "print_transport": "WINDOWS_DRIVER",
  "transporte": "WINDOWS_DRIVER"
}
```

### Teste minimo

**Dry-run (salva PNG, nao imprime):**
```powershell
node scripts/test_argox_windows_driver_minimal_dry_run.js
```

**Real (1 etiqueta, sem RAW):**
```powershell
$env:ARGOX_CONFIRM_REAL_PRINT="true"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
node scripts/test_argox_windows_driver_minimal_real.js
```

Esperado no papel: `TESTE AEROSTORE` e `COD 123456`.

#### Conteudo pequeno / metade esquerda (foto real)

Diagnostico:
- O PNG e **320x480** (40x60mm @ 203dpi) com **1 coluna** — nao e layout de duas colunas.
- O driver Argox costuma reportar `PageBounds` **mais largo** que 40mm (rolo 2-up). Desenhar so 40mm no canto deixa metade da tag em branco e conteudo encolhido.

Correcao em `print-driver-image.ps1`:
- PNG esticado para **`PageBounds` inteiro** (area imprimivel do driver)
- margens zero, escala/offset configuraveis
- layout PNG expandido via `applyFullTagLayout` para ocupar largura util

Ajuste fino (`.env` ou PowerShell):

```env
ARGOX_DRIVER_SCALE_X=1
ARGOX_DRIVER_SCALE_Y=1
ARGOX_DRIVER_OFFSET_X_MM=0
ARGOX_DRIVER_OFFSET_Y_MM=0
ARGOX_DRIVER_DEBUG_BORDER=true
```

Com `ARGOX_DRIVER_DEBUG_BORDER=true`, o PNG dry-run ganha **borda vermelha** e **linhas centrais** — a borda deve encostar nas 4 extremidades da tag virtual 320x480. Se na impressao a borda nao encostar, ajuste `SCALE_X`/`SCALE_Y`.

### Teste full (etiqueta completa, qty 1)

**Dry-run:**
```powershell
node scripts/test_argox_windows_driver_full_dry_run.js
```
Conferir `full-driver-dry-run-*.png` — deve parecer com o preview PDV (marca, nome, grade, barcode, DE/POR).

**Real:**
```powershell
$env:ARGOX_CONFIRM_REAL_PRINT="true"
$env:ARGOX_SAFE_TEST_MODE="true"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
node scripts/test_argox_windows_driver_full_real.js
```

Se sair cortado, ajuste papel/margem/escala no driver print — **nao volte para RAW**.

---

## PRN oficial — captura e validacao (opcional / RAW)

### Objetivo

Descobrir **exatamente** quais bytes esta instalacao da Argox entende quando imprime de verdade. A pagina de teste do Windows ja imprime; os testes minimos PPLA/PPLB gerados por nos foram aceitos pelo spooler mas **nao imprimiram** — isso indica envelope/linguagem errada, nao necessariamente transporte quebrado.

### Interpretacao rapida

| Resultado | Conclusao |
|-----------|-----------|
| PRN oficial imprime via `send_argox_prn_real.js` | Transporte WINSPOOL_RAW OK → adaptar gerador ao PRN oficial |
| PRN oficial **nao** imprime via script, mas imprime pelo driver | Problema de permissao/porta RAW/driver — nao refazer layout |
| Nada imprime nem pelo driver | Hardware/cabo/sensor/driver — fora do escopo do gerador |

### Passo 0 — Confirmar hardware

1. Imprimir **pagina de teste** do Windows na fila `Argox OS-214 plus series PPLA`.
2. Se falhar aqui, pare: resolva driver/USB/sensor antes de RAW.

---

### Metodo 1 — Porta FILE: (recomendado no Windows)

Captura o job exatamente como o driver enviaria para a impressora.

1. Crie uma pasta de captura, ex.: `C:\ArgoxCaptura\`
2. **Painel de Controle** → **Dispositivos e Impressoras**
3. Clique direito na Argox → **Propriedades da impressora** → aba **Portas**
4. **Adicionar porta...** → **Local Port** → Next
5. Nome da porta: `FILE: C:\ArgoxCaptura\oficial-teste.prn`
6. Marque essa porta FILE como selecionada para a Argox (temporariamente)
7. Abra **Argox Printer Tool** (ou utilitario do driver) e imprima uma etiqueta simples com texto **`TESTE AEROSTORE`**
8. Confirme que o arquivo `C:\ArgoxCaptura\oficial-teste.prn` foi criado e tem tamanho > 0 bytes
9. **Restaure a porta original** (`USB002`) antes de continuar
10. Copie o `.prn` para o projeto, ex.: `agente-impressao-argox/output/oficial-driver.prn`

---

### Metodo 2 — Argox Printer Tool / driver Argox

1. Abra **Argox Printer Tool** ou o utilitario instalado com o driver OS-214 Plus PPLA
2. Crie etiqueta minima **40 x 60 mm** com um unico texto: `TESTE AEROSTORE`
3. Procure opcoes do tipo:
   - **Print to file** / **Imprimir para arquivo**
   - **Export PRN**
   - **Save label** / **Export command**
4. Salve como `.prn` em `agente-impressao-argox/output/`
5. Se so imprimir direto na USB, use o **Metodo 1 (FILE:)** no mesmo job

---

### Metodo 3 — ArgoBar / BarTender / outro editor Argox

1. Layout minimo: texto `TESTE AEROSTORE`, 1 etiqueta, sem barcode complexo
2. Tamanho **40 x 60 mm**, mesma impressora Windows
3. Exporte/imprima para arquivo conforme o software permitir
4. Se o software gerar varios formatos, prefira **PRN / RAW / Command file**
5. Copie o arquivo final para `agente-impressao-argox/output/`

---

### Metodo 4 — Captura avancada do spool (somente se 1–3 falharem)

1. Anote horario exato de uma impressao de teste que **saiu no papel** pelo driver
2. Em **Servicos**, reinicie o spooler somente se souber reimprimir depois
3. Pasta tipica: `C:\Windows\System32\spool\PRINTERS\`
4. Arquivos `.SPL/.SHD` **nao sao PRN puro** — exigem conversao e permissoes de admin
5. Use este metodo apenas com suporte tecnico; prefira **FILE:**

---

### Passo final — validar transporte com PRN oficial

Com a porta USB restaurada e **1 etiqueta** no rolo:

```powershell
cd C:\CAMINHO\DO\PROJETO
$env:ARGOX_CONFIRM_REAL_PRINT="true"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
node scripts/send_argox_prn_real.js agente-impressao-argox\output\oficial-driver.prn
```

O script:
- envia **exatamente** os bytes do arquivo (sem converter linguagem)
- exige `ARGOX_CONFIRM_REAL_PRINT=true`
- usa `ARGOX_PRINTER_NAME`
- salva copia de auditoria em `agente-impressao-argox/output/oficial-enviado-*.prn`
- mostra hex/preview do inicio do arquivo no terminal

**Se imprimir:** guarde esse `.prn` como referencia. Proximo passo e mapear envelope/comandos oficiais no gerador — **sem refazer layout visual**.

**Se nao imprimir:** compare permissoes da fila, driver PPLA, porta USB002 e se o mesmo arquivo foi gerado durante uma impressao que funcionou pelo driver.

---

## Impressora PPLA no Windows (seu caso)

Se a fila do Windows aparece como **`Argox OS-214 plus series PPLA`**, isso **nao garante** qual envelope RAW a impressora executa. **Nao chute PPLA/PPLB** — capture o PRN oficial (secao acima) antes de ajustar gerador.

Status atual desta instalacao:
- Pagina de teste Windows: **imprime**
- Testes minimos PPLA/PPLB via Winspool: **aceitos, sem saida fisica**
- Proximo passo: **PRN oficial + `send_argox_prn_real.js`**

Config minima recomendada:

**`.env` na raiz do projeto:**
```env
ARGOX_LANGUAGE=PPLB
ARGOX_LABEL_LANGUAGE=PPLB
ARGOX_PHYSICAL_LANGUAGE=PPLB
ARGOX_PRINTER_NAME=Argox OS-214 plus series PPLA
ARGOX_AGENT_URL=http://localhost:4000
ARGOX_SAFE_TEST_MODE=true
```

**Terminal do agente (PowerShell):**
```powershell
$env:ARGOX_LANGUAGE="PPLB"
$env:ARGOX_PHYSICAL_LANGUAGE="PPLB"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
$env:ARGOX_AGENT_DRY_RUN="false"
$env:ARGOX_SAFE_TEST_MODE="true"
node server.js
```

Antes de imprimir, confirme:
```powershell
curl http://localhost:4000/status
```
Esperado: `"linguagem":"PPLB"`, `"linguagem_fisica":"PPLB"`, `"dry_run":false`, `"safe_test_mode":true`, `"conectada":true`.

> **Nota:** O nome da fila Windows pode continuar contendo "PPLA". O que importa para RAW e `ARGOX_PHYSICAL_LANGUAGE=PPLB`.

Logs do agente em `POST /imprimir` (terminal do agente):
```text
[ARGOX IMPRIMIR] {"sucesso":true,"impressora":"Argox OS-214 plus series PPLA","linguagem":"PPLB","bytes":...,"metodo":"WINSPOOL_RAW",...}
```

---

## Arquitetura (resumo)

```
Browser (PDV /pdv/produtos)
    → server.js :3000  (/api/pdv/labels/print → gera agent_payload + language)
    → agente-impressao-argox :4000  (GET /status, POST /imprimir → PPLA ou PPLB)
    → Windows Print Spooler (RAW)
    → Argox OS-214 Plus
```

---

## Arquivos da entrega Argox

| Caminho | Função |
|---------|--------|
| `agente-impressao-argox/server.js` | Agente HTTP local (porta 4000) |
| `agente-impressao-argox/package.json` | Sem dependencia npm nativa; transporte RAW via Winspool/PowerShell |
| `agente-impressao-argox/lib/winspoolRaw.js` | Envio RAW Windows (metodo `WINSPOOL_RAW`) |
| `agente-impressao-argox/scripts/send-raw.ps1` | WritePrinter via Winspool |
| `agente-impressao-argox/.env.example` | Variáveis do agente na loja |
| `agente-impressao-argox/output/` | `.prn` salvos em **dry-run** (não versionar conteúdo) |
| `modules/pdv/services/argoxPplbGenerator.js` | Gerador PPLB (layout validado) |
| `modules/pdv/services/argoxCommandBuilder.js` | Roteamento PPLA/PPLB a partir do payload |
| `modules/pdv/services/pdvLabelPrintService.js` | API labels + PPLA preview elements + `agent_payload` |
| `modules/pdv/routes/pdvLabelRoutes.js` | Rotas `/api/pdv/labels/*` |
| `public/app.js` | Drawer etiqueta → chama `localhost:4000` |
| `.env.example` | `ARGOX_LANGUAGE`, `ARGOX_LABEL_LANGUAGE`, `ARGOX_AGENT_URL`, etc. |
| `scripts/pdv_argox_pplb_smoke.js` | Smoke do gerador PPLB |
| `scripts/pdv_argox_ppla_agent_smoke.js` | Smoke PPLA via payload do agente |
| `scripts/pdv_argox_ppla_prn_smoke.js` | Smoke PPLA preview-derived |
| `scripts/test_argox_agent_dry_run.js` | Teste integrado do agente (sobe/valida/encerra) |
| `scripts/test_argox_ppla_minimal_dry_run.js` | Teste minimo PPLA dry-run (gera `.prn`) |
| `scripts/test_argox_ppla_minimal_real.js` | Teste minimo PPLA real (qty 1, exige confirmacao) |
| `scripts/test_argox_pplb_minimal_dry_run.js` | Teste minimo PPLB/EPL-like dry-run (gera `.prn`) |
| `scripts/test_argox_pplb_minimal_real.js` | Teste minimo PPLB/EPL-like real (qty 1, exige confirmacao) |
| `scripts/send_argox_prn_real.js` | Envia PRN externo bruto via Winspool (validacao RAW) |
| `scripts/test_argox_windows_driver_minimal_dry_run.js` | Gera PNG minimo via WINDOWS_DRIVER |
| `scripts/test_argox_windows_driver_minimal_real.js` | Imprime PNG minimo via driver Windows |
| `scripts/test_argox_windows_driver_full_dry_run.js` | Gera PNG da etiqueta completa (preview PDV) |
| `scripts/test_argox_windows_driver_full_real.js` | Imprime etiqueta completa qty 1 via driver |
| `agente-impressao-argox/lib/fullLabelDriver.js` | Monta imageSpec a partir do preview PDV |
| `agente-impressao-argox/lib/windowsDriverPrint.js` | Render + impressao bitmap via driver |
| `agente-impressao-argox/lib/printTransport.js` | Roteamento RAW vs WINDOWS_DRIVER |
| `scripts/generate_argox_ppla_dry_run_output.js` | Gera `.prn` completo em `agente-impressao-argox/output/` |
| `modules/pdv/services/argoxPplaEnvelope.js` | Envelope PPLA validado (Q480, q320/q664, H, P1, E) |
| `scripts/windows/send-argox-raw.ps1` | Fallback manual RAW (opcional) |

**Não precisa copiar manualmente** se o PC da loja usar o mesmo repositório Git: `git pull` traz tudo acima (após commit/push do PC de casa).

---

## Etapa obrigatoria antes da etiqueta completa (loja)

Siga esta ordem **sempre**:

### 0. Teste minimo WINDOWS_DRIVER (prioridade maxima)

1. Dry-run:
   ```powershell
   node scripts/test_argox_windows_driver_minimal_dry_run.js
   ```
2. Conferir PNG em `agente-impressao-argox/output/minimal-driver-dry-run-*.png`
3. Impressao real:
   ```powershell
   $env:ARGOX_CONFIRM_REAL_PRINT="true"
   $env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
   node scripts/test_argox_windows_driver_minimal_real.js
   ```
4. **So continue** se imprimir **as duas linhas** (`TESTE AEROSTORE` + `COD 123456`)

5. Full dry-run:
   ```powershell
   node scripts/test_argox_windows_driver_full_dry_run.js
   ```
6. Conferir PNG `full-driver-dry-run-*.png` vs preview PDV
7. Full real qty 1:
   ```powershell
   $env:ARGOX_CONFIRM_REAL_PRINT="true"
   $env:ARGOX_SAFE_TEST_MODE="true"
   $env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
   node scripts/test_argox_windows_driver_full_real.js
   ```
8. **So entao** testar etiqueta completa pelo PDV com agente em `ARGOX_PRINT_TRANSPORT=WINDOWS_DRIVER`

### 0b. PRN oficial (somente se quiser retomar investigacao RAW)

1. Capturar PRN pelo driver/Printer Tool (secao **PRN oficial** no topo deste guia)
2. Validar com:
   ```powershell
   $env:ARGOX_CONFIRM_REAL_PRINT="true"
   $env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
   node scripts/send_argox_prn_real.js agente-impressao-argox\output\oficial-driver.prn
   ```
3. **So continue** se o PRN oficial imprimir via script

### 1. Calibrar sensor / gap / furo no Printer Tool da Argox

No **Argox Printer Tool** (ou utilitario do driver):

1. Carregar tamanho **40 x 60 mm** (ou equivalente em dots: largura 320, altura 480 @ 203 dpi).
2. Rodar **Auto Detect** / calibracao de gap ou furo conforme o rolo instalado.
3. Imprimir pagina de teste do driver e confirmar que a impressora para **no inicio de cada tag**, sem avancar varias etiquetas em branco.

### 2. Teste minimo dry-run (sem papel)

```powershell
node scripts/test_argox_pplb_minimal_dry_run.js
node scripts/test_argox_ppla_minimal_dry_run.js
node scripts/generate_argox_ppla_dry_run_output.js
```

Conferir o `.prn` em `agente-impressao-argox/output/`:

**PPLB/EPL-like (prioridade nesta Argox):**
- Deve conter `N`, `q320`, `Q480`, `P1`
- **Nao** deve conter `\x02L` nem `E` de envelope PPLA

**PPLA (manter no codigo, mas pode nao imprimir nesta fila):**
- Deve conter `\x02L`, `H024`, `Q0480`, `q0320`, **`P1`**, `E`
- **Nao** pode conter `P20`, `Q0001` ou blocos repetidos indevidos

### 3. Teste minimo real (1 tag apenas)

Com agente rodando e **`ARGOX_SAFE_TEST_MODE=true`**:

**Primeiro — PPLB/EPL-like (recomendado nesta instalacao):**
```powershell
$env:ARGOX_CONFIRM_REAL_PRINT="true"
$env:ARGOX_SAFE_TEST_MODE="true"
$env:ARGOX_PHYSICAL_LANGUAGE="PPLB"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
node scripts/test_argox_pplb_minimal_real.js
```

**Opcional — PPLA (se quiser comparar):**
```powershell
node scripts/test_argox_ppla_minimal_real.js
```

Esperado na **primeira tag**:

- Texto `TESTE AEROSTORE`
- Texto `COD 123456`
- Conteudo proximo ao centro da tag (ajuste fino depois, se necessario)

**So avance** se o teste minimo imprimir **dentro** da primeira tag, sem avancar dezenas de etiquetas vazias.

### 4. Etiqueta completa pelo PDV

Somente depois dos passos 1–3:

1. Confirmar `ARGOX_SAFE_TEST_MODE=true` no agente (maximo 1 copia).
2. Imprimir **1 etiqueta** pelo drawer do PDV.
3. Conferir o `.prn` salvo automaticamente em `agente-impressao-argox/output/` e os logs `[ARGOX IMPRIMIR]` no terminal do agente.

---

## Antes de ir para a loja (PC de casa)

### 1. Confirmar testes automáticos

```powershell
cd C:\CAMINHO\DO\PROJETO
node scripts/pdv_argox_pplb_smoke.js
node scripts/pdv_argox_ppla_agent_smoke.js
node scripts/pdv_argox_ppla_prn_smoke.js
node scripts/test_argox_pplb_minimal_dry_run.js
node scripts/test_argox_ppla_minimal_dry_run.js
node scripts/generate_argox_ppla_dry_run_output.js
node scripts/test_argox_agent_dry_run.js
```

Todos devem terminar sem erro.

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
ARGOX_LANGUAGE=PPLA
ARGOX_LABEL_LANGUAGE=PPLA
ARGOX_AGENT_URL=http://localhost:4000
ARGOX_PRINTER_NAME=Argox OS-214 plus series PPLA
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
2. Anotar o nome da impressora no Windows (ex.: `Argox OS-214 plus series PPLA`).
3. Configurar `ARGOX_LANGUAGE=PPLA` se a fila/driver for PPLA.
4. **Não usar Zadig / WinUSB** — o agente usa o spooler normal.

### Dependências Node

```powershell
cd C:\CAMINHO\DO\PROJETO
npm install

cd agente-impressao-argox
npm install
```

`npm install` no agente **nao instala modulos nativos** (package.json sem dependencias). Impressao real usa Winspool via PowerShell embutido.

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
$env:ARGOX_LANGUAGE="PPLA"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
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
  "linguagem": "PPLA",
  "impressora": "SIMULADO (sem impressora)"
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
$env:ARGOX_LANGUAGE="PPLA"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
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
| `linguagem` | `PPLA` (se driver PPLA) ou `PPLB` |
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
| `node-printer indisponivel` | Versao antiga removida | Agente usa `lib/winspoolRaw.js`; rode `npm install` (vazio) e reinicie |
| Sucesso no PDV mas papel em branco / sem job | Linguagem errada (PPLB em driver PPLA) | Setar `ARGOX_LANGUAGE=PPLA` no `.env` e no agente; reiniciar agente |
| Sucesso no PDV mas papel em branco | Fila/driver errado ou RAW não aceito | Testar `.prn` de `output/` com `send-argox-raw.ps1` |
| PRN OK, Argox não | Cabo/USB, tampa, sem papel | Fila de impressão do Windows mostra o erro |

---

## Comandos rápidos (cola na loja)

```powershell
# Testes automáticos (sem deixar servidor aberto)
node scripts/pdv_argox_pplb_smoke.js
node scripts/pdv_argox_ppla_agent_smoke.js
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

## Layout final aprovado (WINDOWS_DRIVER)

Versao congelada validada na loja:

- Transporte: `WINDOWS_DRIVER` (nao usar RAW/PPLA/PPLB como caminho principal)
- Canvas: **320x480** (1 etiqueta 40x60mm)
- Grid: **1x1** (env `ARGOX_LABEL_GRID=2x2` e ignorado no fluxo real)
- `TOP_BLOCK_OFFSET_PX = 60` (AEROSTORE livre do furo da tag)
- Barcode, rodape/serrilhado e fontes: congelados

### Config final recomendada

Raiz do projeto (`.env`):

```env
ARGOX_AGENT_URL=http://localhost:4000
ARGOX_PRINT_TRANSPORT=WINDOWS_DRIVER
ARGOX_PRINTER_NAME=Argox OS-214 plus series PPLA
ARGOX_SAFE_TEST_MODE=true
ARGOX_LABEL_GRID=1x1
ARGOX_LABEL_WIDTH_MM=40
ARGOX_LABEL_HEIGHT_MM=60
ARGOX_DRIVER_DEBUG_BORDER=false
```

Agente (`agente-impressao-argox/.env` ou PowerShell):

```env
ARGOX_PRINT_TRANSPORT=WINDOWS_DRIVER
ARGOX_PRINTER_NAME=Argox OS-214 plus series PPLA
ARGOX_SAFE_TEST_MODE=true
ARGOX_AGENT_DRY_RUN=false
ARGOX_DRIVER_DEBUG_BORDER=false
ARGOX_LABEL_GRID=1x1
```

### Subir PDV

```powershell
cd C:\CAMINHO\DO\PROJETO
node server.js
```

URL: `http://localhost:3000`

### Subir agente Argox (impressao real)

```powershell
cd C:\CAMINHO\DO\PROJETO\agente-impressao-argox
$env:ARGOX_PRINT_TRANSPORT="WINDOWS_DRIVER"
$env:ARGOX_PRINTER_NAME="Argox OS-214 plus series PPLA"
$env:ARGOX_SAFE_TEST_MODE="true"
$env:ARGOX_AGENT_DRY_RUN="false"
$env:ARGOX_DRIVER_DEBUG_BORDER="false"
node server.js
```

### Testar pelo PDV

1. Abrir `http://localhost:3000/pdv/produtos`
2. Selecionar produto → **Etiqueta** → **Imprimir etiqueta**
3. Quantidade **1** enquanto `ARGOX_SAFE_TEST_MODE=true`
4. Confirmar status do agente online em `/status`

### Liberar quantidade normal (depois dos testes)

Quando estiver confortavel com a impressao fisica:

```powershell
$env:ARGOX_SAFE_TEST_MODE="false"
```

Reinicie o agente. O PDV passara a respeitar a quantidade informada na tela (ainda 1 etiqueta por job WINDOWS_DRIVER por seguranca de layout).

### Validacao rapida (dry-run)

```powershell
cd C:\CAMINHO\DO\PROJETO
node scripts/test_argox_windows_driver_full_dry_run.js
```

Esperado: `width_px: 320`, `height_px: 480`, `grid: 1x1`, `top_block_offset_px: 60`.

Se aparecer **640x960**, pare: regressao de grade 2x2.

### Criterio de sucesso

- [ ] Imprime **1 etiqueta** por teste
- [ ] Layout ocupa 40x60mm inteiro
- [ ] AEROSTORE livre do furo
- [ ] Barcode legivel
- [ ] COD / DE / POR no serrilhado
- [ ] Sem bordas de debug na impressao real

---

## Checklist final na loja

- [ ] `git pull` (ou pasta copiada) com `agente-impressao-argox` e `argoxPplbGenerator.js`
- [ ] `npm install` na raiz e em `agente-impressao-argox`
- [ ] `.env` com `ARGOX_LANGUAGE=PPLA` se fila Windows for PPLA
- [ ] Teste simulado: `/status` → `dry_run: true` → `.prn` em `output/`
- [ ] Teste real: `/status` → `dry_run: false` + impressora detectada
- [ ] 1 etiqueta física de teste antes de lote grande

---

## Suporte

Se impressão real falhar mas dry-run e `.prn` estiverem corretos, o problema é **ambiente Windows/impressora**, não o layout PPLB. Envie:

1. Saída de `curl http://localhost:4000/status`
2. Nome exato da impressora no Windows
3. Foto da etiqueta impressa (se sair algo)
