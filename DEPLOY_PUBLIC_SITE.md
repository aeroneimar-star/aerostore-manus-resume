# Deploy — Site público AEROSTORE (aerostore.site)

Checklist para publicar a landing institucional separada do CRM/PDV interno.

## Domínios

| Domínio | Função |
|---------|--------|
| `aerostore.site` | Landing pública (Fase 1) e futuro e-commerce |
| `www.aerostore.site` | Alias da landing (recomendado redirecionar para apex ou servir igual) |
| `crm.aerostore.site` | CRM/PDV interno (sem mudança de paths) |

## DNS

Apontar para o mesmo IP do VPS:

- `A` / `AAAA` → `aerostore.site`
- `A` / `AAAA` ou `CNAME` → `www.aerostore.site`
- `A` / `AAAA` ou `CNAME` → `crm.aerostore.site` (já existente)

## Variáveis de ambiente (produção)

```env
NODE_ENV=production
AEROSTORE_PUBLIC_BASE_URL=https://aerostore.site
AEROSTORE_PUBLIC_SITE_HOST=aerostore.site,www.aerostore.site
AEROSTORE_CRM_HOST=crm.aerostore.site
```

## Nginx (exemplo)

Dois `server` blocks apontando para o mesmo upstream Node:

```nginx
upstream aerostore_node {
  server 127.0.0.1:3000;
  keepalive 32;
}

server {
  listen 443 ssl http2;
  server_name aerostore.site www.aerostore.site;

  # certificados TLS (Let's Encrypt ou provedor)

  location / {
    proxy_pass http://aerostore_node;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
  }
}

server {
  listen 443 ssl http2;
  server_name crm.aerostore.site;

  location / {
    proxy_pass http://aerostore_node;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

O roteamento por hostname é feito no Express (`modules/public-site`).

## Conteúdo institucional

Editar antes do go-live:

- [`modules/public-site/config/site-content.json`](modules/public-site/config/site-content.json)
  - razão social e CNPJ reais
  - WhatsApp e Instagram oficiais
  - endereços e horários das lojas

## Validação pós-deploy

- [ ] `https://aerostore.site/` — landing institucional
- [ ] `https://aerostore.site/privacidade`
- [ ] `https://aerostore.site/termos`
- [ ] `https://aerostore.site/robots.txt`
- [ ] `https://aerostore.site/sitemap.xml`
- [ ] `https://crm.aerostore.site/` — redirect para `/pdv`
- [ ] `https://crm.aerostore.site/pdv/venda` — SPA interna
- [ ] `https://crm.aerostore.site/api/health` — API intacta
- [ ] `https://aerostore.site/pdv` — deve retornar 404 do site público (não expor CRM)

## Desenvolvimento local

`localhost` continua como CRM por padrão.

Testar landing localmente com header Host:

```bash
curl -H "Host: aerostore.site" http://localhost:3000/
curl -H "Host: crm.aerostore.site" http://localhost:3000/
```

Ou adicionar no arquivo `hosts` do sistema:

```
127.0.0.1 aerostore.site
127.0.0.1 crm.aerostore.site
```

## Fases futuras (reservado)

- `aerostore.site/catalogo` — catálogo público (Fase 2)
- `aerostore.site/produto/:slug` — página de produto (Fase 3)
- `/public-api/*` — API pública sanitizada (separada de `/api`)
