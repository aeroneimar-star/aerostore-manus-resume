# Deploy Multi-Instancia AEROSTORE

## Checklist por loja

### Pre-requisitos do PC
- [ ] Windows 10/11 ou Linux
- [ ] Node.js 18+ instalado
- [ ] Chrome ou Chromium instalado
- [ ] Internet estavel
- [ ] Celular com WhatsApp da loja

### Instalacao
- [ ] Copiar a pasta do projeto para o PC
- [ ] Copiar `config/instance.LOJA.json` para `config/instance.json`
- [ ] Rodar `npm install`
- [ ] Rodar `node server.js`
- [ ] Acessar `http://localhost:3000`

### Conexao WhatsApp
- [ ] Abrir `Operacao > WhatsApp CRM`
- [ ] Escanear o QR Code com o celular da loja
- [ ] Confirmar status `Conectado`
- [ ] Confirmar numero correto na UI

### Validacao
- [ ] Enviar mensagem de teste
- [ ] Confirmar recebimento pelo numero da loja
- [ ] Abrir PDV e fazer venda teste
- [ ] Abrir Campanhas e verificar motor humanizado
- [ ] Confirmar warmup no dia 0 para numero novo

## Estrategia inicial recomendada

Nesta stage, cada loja roda isolada no proprio PC com a propria sessao WhatsApp e a propria base local.

- Vila Masc. -> `config/instance.vila_masc.json`
- Vila Fem. e Infantil -> `config/instance.vila_fem.json`
- Botanico -> `config/instance.botanico.json`
- Sul -> `config/instance.sul.json`

Sincronizacao entre lojas fica para uma stage futura.
