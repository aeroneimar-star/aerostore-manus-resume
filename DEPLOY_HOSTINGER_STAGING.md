# Deploy Hostinger Staging

Checklist controlado para um ambiente de teste. Nao use este roteiro para producao sem nova revisao de seguranca, dados e integracoes.

## Ambiente

- [ ] Confirmar o plano Hostinger com suporte ao runtime Node.js necessario.
- [ ] Preferir staging isolado em VPS/ambiente Node dedicado.
- [ ] Definir subdominio, por exemplo `staging.aerostore.com.br` ou `crm-teste.aerostore.com.br`.
- [ ] Apontar DNS e habilitar HTTPS antes de testes externos.
- [ ] Usar uma copia privada do repositorio sem `data/`, `.env`, uploads reais ou sessoes locais.

## Variaveis

- [ ] Criar `.env` no servidor a partir de `.env.example`.
- [ ] Definir `NODE_ENV`, `PORT`, base URL publica e segredos fortes.
- [ ] Manter `PAGBANK_ENV=sandbox` no staging.
- [ ] Manter tokens PagBank, OpenAI e Tiny fora do Git.
- [ ] Definir se WhatsApp fica desabilitado no staging ou se tera sessao controlada.

## Instalar e iniciar

```bash
npm install
npm run check
npm start
```

Se o painel/servidor usar gerenciador de processo, iniciar o app com a porta definida para a aplicacao e configurar restart supervisionado.

## Persistencia

- [ ] Provisionar persistencia para `data/`.
- [ ] Provisionar persistencia para `public/uploads/`.
- [ ] Definir se `tmp/labels/` precisa ser mantido ou limpo periodicamente.
- [ ] Definir backup de SQLite, JSON operacionais e uploads.
- [ ] Nao importar base real de clientes/vendas no primeiro staging sem sanitizacao.

## Validacao tecnica

- [ ] `/api/health`
- [ ] `/login`
- [ ] `/pdv/venda`
- [ ] `/pdv/caixa`
- [ ] `/pdv/produtos`
- [ ] `/settings`
- [ ] `/whatsapp-crm`
- [ ] `/aerointel`
- [ ] Validar perfis admin, manager e seller.

## PagBank

- [ ] Usar sandbox no staging.
- [ ] Configurar URLs de webhook/retorno para o dominio de staging.
- [ ] Nao misturar token sandbox e producao.
- [ ] Confirmar status de link e fila de aguardando pagamento antes de qualquer piloto.

## WhatsApp

- [ ] Decidir se o WhatsApp roda no servidor ou em uma maquina local controlada.
- [ ] Se usar sessao no servidor, persistir a pasta de sessao fora do Git.
- [ ] Validar Chromium/ambiente do WhatsApp Web antes de liberar mensagens.

## Argox

- [ ] Tratar Argox como recurso da estacao local da loja.
- [ ] Usar staging para preview/PRN, nao para prometer impressao fisica remota.

## Seguranca

- [ ] HTTPS ativo.
- [ ] Segredos fortes e fora do repositorio.
- [ ] `.env`, backups, dados, logs, uploads e sessoes nao expostos por HTTP.
- [ ] Revisar escopo de lojas/perfis antes de piloto.

## Antes de producao

- [ ] Definir strategy de seed/migracao de dados.
- [ ] Definir backup e restauracao testada.
- [ ] Definir observabilidade/logs sem dados sensiveis.
- [ ] Revalidar checkout, PagBank, WhatsApp, permissao e regressao com ambiente real.
