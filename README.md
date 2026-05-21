# AEROSTORE CRM / PDV

Sistema operacional AEROSTORE em Node.js, Express e SQLite para CRM, PDV e rotinas de loja.

## Requisitos

- Node.js 20 LTS recomendado.
- npm disponivel no terminal.
- Variaveis locais configuradas a partir de `.env.example`.
- Persistencia local protegida para banco, dados operacionais, uploads e sessoes.

## Setup local

1. Copie `.env.example` para `.env`.
2. Preencha os segredos e integracoes necessarias no `.env`.
3. Instale dependencias.
4. Inicie o servidor.

```bash
npm install
npm start
```

Depois abra `http://localhost:3000`.

No Windows, se o PowerShell bloquear `npm`, use:

```powershell
npm.cmd install
npm.cmd start
```

## Scripts uteis

```bash
npm start
npm run check
node --check server.js
node --check public/app.js
node scripts/stage823_permissions_scope_smoke.js
node scripts/stage825_regression_smoke.js
node scripts/stage826_checkout_consistency_smoke.js
```

Os smokes usam o servidor local e podem depender de usuarios/dados de teste do ambiente.

## Pastas importantes

- `public/`: shell, estilos e JavaScript do frontend.
- `modules/pdv/`: rotas, servicos e utilitarios do PDV.
- `services/`: servicos compartilhados, como PagBank e configuracao de loja.
- `data/`: banco, JSON operacionais, imports, logs e runtime local.
- `public/uploads/products/`: fotos enviadas no cadastro de produto.
- `tmp/labels/`: arquivos PRN gerados para etiquetas Argox.
- `config/instance.template.json`: base segura para configuracao local por instancia.

## Preparacao segura para Git

Nao versionar dados reais ou runtime local. O `.gitignore` bloqueia por padrao:

- `.env` e variantes com segredos.
- `node_modules/`.
- `data/`, SQLite e logs.
- sessoes WhatsApp e perfis de navegador.
- backups, QA artifacts, temporarios e exports.
- uploads reais de produtos.

Antes do primeiro commit privado, revise o que sera adicionado com `git status` e `git diff --stat`.

## Dados e persistencia

O workspace atual usa SQLite e JSON locais. Para staging, trate estes caminhos como volumes/pastas persistentes fora do commit:

- `data/`
- `public/uploads/`
- sessoes WhatsApp, se o WhatsApp rodar no servidor

Nao copie vendas, clientes, telefones, cashback, cupons, imports ou logs reais para GitHub. Se staging precisar nascer populado, gere uma seed sanitizada e revise-a antes de versionar.

## Deploy staging

Use `DEPLOY_HOSTINGER_STAGING.md` para o checklist controlado de staging.

Pontos de atencao:

- Hostinger precisa ser escolhido conforme o plano Node.js disponivel.
- PagBank deve permanecer em sandbox no staging.
- WhatsApp Web e LocalAuth exigem decisao de execucao e persistencia de sessao.
- Impressao Argox depende da estacao da loja, nao da VPS.
- Uploads precisam de persistencia e backup.

## Rotas de validacao

- `/api/health`
- `/login`
- `/pdv/venda`
- `/pdv/caixa`
- `/pdv/produtos`
- `/settings`
- `/whatsapp-crm`
- `/aerointel`

## Materiais complementares

- `DEPLOY_MULTI_INSTANCE.md`: operacao local por instancia/loja.
- `DEPLOY_HOSTINGER_STAGING.md`: preparacao de staging na Hostinger.
