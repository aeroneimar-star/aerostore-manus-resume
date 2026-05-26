# Recovery atual seguro

Este e o ponto de recovery recomendado para restauracoes a partir de agora:

```text
_recovery_backups/2026-05-24-0328-safe-point-0159-visual-product-search-whatsapp-qr-manual/
```

Este ponto usa como base visual o recovery solicitado:

```text
_recovery_backups/2026-05-24-0159-pdv-sale-product-search-visual-fix/
```

Mas ja inclui, por cima, as duas correcoes cirurgicas que nao devem ser perdidas:

- busca de produto do PDV sem skeleton preso;
- cards da busca visiveis e operacionais em `/pdv/venda`;
- modo seguro de QR Code do WhatsApp;
- QR Code do WhatsApp liberado somente por acao manual em `/whatsapp-crm`;
- configuracao `qr_manual_refresh` ativa;
- endpoint `/api/whatsapp/qr/refresh`.

## Nao usar como ponto principal

```text
_recovery_backups/2026-05-24-0308-safe-point-product-search-whatsapp-qr-manual/
_recovery_backups/2026-05-24-0319-safe-point-visual-original-product-search-whatsapp-qr-manual/
```

Esses pontos nao representam o visual que foi escolhido como correto nesta rodada.

Tambem nao restaurar o `0159` cru como ponto final, porque ele volta com a busca de produto quebrada e sem a protecao manual do QR Code.

## Arquivos cobertos pelo ponto seguro

```text
server.js
public/app.js
public/styles.css
public/index.html
config/instance.json
config/instance.template.json
modules/pdv/services/pdvOperationalService.js
modules/pdv/routes/pdvOperationalRoutes.js
RECOVERY_CURRENT_SAFE_POINT.md
```

## Procedimento de restore

Antes de restaurar, criar um snapshot do estado atual em `_recovery_backups/`.

Depois, copiar os arquivos do ponto seguro para os caminhos originais, preservando a mesma estrutura de pastas.

Validar apos o restore:

```powershell
subst P: C:\Users\ADM\Documents\Codex\2026-04-26\crie-do-zero-um-sistema-chamado
Set-Location P:\
node --check server.js
node --check public\app.js
node --check modules\pdv\services\pdvOperationalService.js
node --check modules\pdv\routes\pdvOperationalRoutes.js
```

Se o servidor estiver rodando, reiniciar o Node para carregar a versao restaurada.
