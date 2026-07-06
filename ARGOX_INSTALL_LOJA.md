# Argox — instalação na loja (AnyDesk)

Guia curto para suporte remoto. Para diagnóstico profundo, use `ARGOX_TESTE_LOJA.md`.

## Pré-requisitos

- Windows 10 ou superior
- Impressora Argox OS-214 instalada no Windows (driver funcionando — página de teste OK)
- Node.js 18+ LTS (o instalador tenta via `winget` se não houver)
- Pacote ZIP: `aerostore-argox-agent-YYYYMMDD.zip`

## Instalação (15–20 min)

1. Copie o ZIP para o PC da loja (AnyDesk → transferência de arquivo).
2. Extraia em:

   `C:\AEROSTORE\argox-agent`

3. Abra PowerShell **como administrador** (recomendado para Task Scheduler).
4. Execute:

```powershell
cd "C:\AEROSTORE\argox-agent"
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-loja.ps1 -PrinterAuto
```

Parâmetros úteis:

```powershell
.\install-loja.ps1 -PrinterName "Argox OS-214 plus series PPLA"
.\install-loja.ps1 -PrinterAuto -Loja "sul"
```

## O que o instalador faz

- Instala dependências (`npm install`)
- Detecta a impressora Argox
- Grava `.env` persistente em `agente-impressao-argox\.env`
- Registra tarefa **AEROSTORE Argox Agent** (inicia no logon)
- Testa `http://localhost:4000/status`
- Roda smoke dry-run

**Na primeira instalação** `ARGOX_SAFE_TEST_MODE=true` — só 1 etiqueta por job.

## Testar status

```powershell
.\health-check.ps1
```

Ou no navegador: `http://localhost:4000/status`

Campos esperados:

- `agent_version`
- `package_version`
- `print_transport`: `WINDOWS_DRIVER`
- `driver_columns`: `2`
- `safe_test_mode`: `true` (até liberar)

## Imprimir 1 etiqueta de teste

```powershell
.\smoke-test.ps1
```

Confirme no papel: **TESTE AEROSTORE** e **COD 123456**.

## Liberar impressão normal

Após aprovar o teste:

```powershell
.\smoke-test.ps1 -AllowDisableSafeMode
```

Ou edite `agente-impressao-argox\.env`:

```env
ARGOX_SAFE_TEST_MODE=false
```

Depois:

```powershell
.\restart-agent.cmd
```

## Reiniciar agente (atalho para a loja)

Duplo clique em `restart-agent.cmd` ou atalho na área de trabalho apontando para ele.

## Logs

`C:\AEROSTORE\logs\argox-agent.log`

## Desinstalar

```powershell
.\uninstall-loja.ps1
```

## PDV

No servidor/`.env` do CRM, confirme:

```env
ARGOX_AGENT_URL=http://localhost:4000
```

No drawer de etiquetas do PDV, o status do agente deve ficar online.

## Gerar novo ZIP (desenvolvimento)

No PC de desenvolvimento:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\build-argox-agent-package.ps1
```

Saída: `dist\aerostore-argox-agent-YYYYMMDD.zip`
