# AEROSTORE scripts

Esta pasta contem ferramentas locais, QA, smoke tests e utilitarios de staging.

## Regras de seguranca

- Nao execute scripts desta pasta em producao.
- Scripts mutaveis devem chamar `blockProduction()` e exigir `--confirm`.
- Use `--dry-run` quando o script oferecer essa opcao.
- Nao rode importadores CRM Bonus/Tiny sem backup revisado.
- Nao commite CSV, XLSX, exports, outputs, reports ou backups com dados reais.
- Nao commite senhas, tokens, PINs, secrets, cookies, `.env` ou sessoes.
- Outputs com PII devem ficar em pastas ignoradas pelo Git.
- Scripts ignorados/local-only nao devem ser adicionados ao Git sem nova auditoria.

## Helper padrao

Use `scripts/scriptSafety.js`:

```js
const { blockProduction, requireExplicitConfirmation, warnLocalOnly } = require("./scriptSafety");

blockProduction("nome-do-script.js");
warnLocalOnly("nome-do-script.js");
requireExplicitConfirmation("--confirm");
```

Em subpastas como `scripts/staging`, use:

```js
const { blockProduction, requireExplicitConfirmation } = require("../scriptSafety");
```

## Scripts de risco

Scripts que importam, exportam, alteram banco, alteram JSON operacional, criam venda, mexem em cashback, estoque, produto, foto ou configuracao de loja devem ser tratados como locais/QA.

Antes de qualquer deploy, confirme que scripts temporarios estao ignorados ou convertidos para `.example`.
