# Shop Fase 2.8.4 — Preparação editorial da vitrine piloto

**Data:** 2026-07-12  
**Modo:** Documentação / estrutura **read-only** — sem código, banco, migration, publicação ou deploy.  
**Catálogo público:** `SHOP_PUBLIC_CATALOG_ENABLED` permanece **OFF**.  
**Origem:** Grupo A de [shop-phase-2.8.3-pilot-selection.md](./shop-phase-2.8.3-pilot-selection.md).  
**Próxima fase técnica:** 2.9 (migration publication layer) **somente após** aprovação humana deste intake + fotos reais.

---

## 1. Objetivo

Transformar os 8 produtos PDV do piloto em **produtos vendáveis no site**: nome comercial, slug, categoria web, copy, tags, brief de fotos e checklist de grade — **sem publicar**.

A vitrine deve ler como **AEROSTORE organizada e premium**, não como lista bruta de estoque.

### Princípios editoriais

1. Nome PDV = referência operacional; vitrine usa **nome editorial**.
2. Evitar ruído técnico: “CORES”, “TECNOLÓGICA”, “FIVE POCKET”, CAIXA ALTA.
3. Publication layer = **espelho** (FK + editorial). SKU, barcode, estoque numérico e custo ficam no PDV — ver [shop-schema-design.md](./shop-schema-design.md).
4. Preço PDV é referência; override web só se negócio decidir depois.
5. Disponibilidade pública (`in_stock` / `low_stock` / `out_of_stock`) é **calculada** na projeção — não inventar saldo aqui.

---

## 2. Ordem sugerida na vitrine (mix premium)

| Ordem | Destaque | Produto editorial | Preço ref. | Papel na vitrine |
|------:|:--------:|-------------------|------------|------------------|
| 1 | sim | Camiseta Series Basic AEROSTORE | R$ 129,90 | Entrada de marca / mid ticket |
| 2 | sim | Camiseta Pima AEROSTORE | R$ 199,90 | Premium algodão |
| 3 | sim | Calça Tech AEROSTORE 5 Pockets | R$ 397,00 | Âncora de bottoms |
| 4 | — | Camiseta Basic AEROSTORE — Preta | R$ 79,90 | Linha Basic (cor) |
| 5 | — | Camiseta Basic AEROSTORE — Off White | R$ 79,90 | Linha Basic |
| 6 | — | Camiseta Basic AEROSTORE — Branco | R$ 79,90 | Linha Basic |
| 7 | — | Camiseta Basic AEROSTORE — Bege | R$ 79,90 | Linha Basic |
| 8 | — | Camiseta Basic AEROSTORE — Brasil | R$ 79,90 | Linha Basic (cor especial) |

**Mix:** 7 camisetas + 1 calça · ticket R$ 79,90 – R$ 397,00 · 100% marca própria AEROSTORE.

**Nota estrutural:** no PDV, cada cor da Basic é **produto separado**. No piloto 2.8.4 mantemos 1 card público por produto PDV (espelho 1:1). Futuro merge em um único PDP com variantes de cor fica para pós-piloto, se fizer sentido operacional.

---

## 3. Fichas editoriais (8 produtos)

Convenções:

- **Slug:** kebab-case, sem acento, único na vitrine.
- **Categoria web:** `camisetas` | `calcas` (taxonomia shop).
- **Fotos:** padrão packshot **4:5**; nome sugerido `{slug}--{cor}--{role}--{seq}.webp` sob `public/shop/assets/img/products/{categoria}/`.
- Campos marcados **PENDENTE** exigem confirmação na loja / sessão de foto antes da 2.9.

---

### 3.1 Camiseta Series Basic AEROSTORE

| Campo | Proposta |
|-------|----------|
| **Nome PDV** | CAMISETA AEROSTORE SERIES BASIC |
| **Nome editorial** | Camiseta Series Basic AEROSTORE |
| **Slug** | `camiseta-series-basic-aerostore` |
| **Categoria web** | `camisetas` / Camisetas |
| **Preço ref. PDV** | R$ 129,90 |
| **Destaque** | sim |
| **Ordem** | 1 |

**Descrição curta**  
Camiseta AEROSTORE Series Basic — corte limpo, caimento regular e acabamento de dia a dia premium.

**Descrição completa**  
A Series Basic é a peça-base da AEROSTORE para quem quer visual limpo sem abrir mão de qualidade. Modelagem regular, gola confortável e tecido pensado para uso contínuo — do casual diário ao look de fim de semana. Ideal para combinar com calças e bermudas da casa.

**Tags / atributos comerciais**  
`linha:series-basic` · `marca:aerostore` · `genero:masculino` *(confirmar)* · `uso:casual` · `ticket:medio` · `featured:true`

**Fotos necessárias**

| Role | Prioridade | Arquivo sugerido |
|------|------------|------------------|
| Packshot frente | Obrigatório | `camiseta-series-basic-aerostore--unico--front--01.webp` |
| Packshot costas | Recomendado | `…--back--01.webp` |
| Detalhe gola/tecido | Recomendado | `…--detail--01.webp` |
| Look vestido | Opcional piloto | `…--look--01.webp` |

**Grade / estoque (observações)**  
- Confirmar cores e tamanhos ativos no pool `vila` / `botanico` / `sul`.  
- Revisar `low_stock` vs `in_stock` por variação antes de publicar.  
- Se for multi-cor no PDV, listar cores públicas no intake; se mono, marcar cor única.

**Pendências antes de publicar**  
- [ ] Foto principal 4:5 aprovada  
- [ ] Grade/tamanhos confirmados  
- [ ] Composição / cuidados (PENDENTE loja)  
- [ ] Aprovação do nome + copy  
- [ ] `product_id` PDV vinculado no intake 2.9  

---

### 3.2 Camiseta Basic AEROSTORE — Preta

| Campo | Proposta |
|-------|----------|
| **Nome PDV** | CAMISETA AEROSTORE BASIC CORES PRETO |
| **Nome editorial** | Camiseta Basic AEROSTORE — Preta |
| **Slug** | `camiseta-basic-aerostore-preta` |
| **Categoria web** | `camisetas` / Camisetas |
| **Preço ref. PDV** | R$ 79,90 |
| **Destaque** | não |
| **Ordem** | 4 |
| **Cor editorial** | Preto |

**Descrição curta**  
Camiseta Basic preta AEROSTORE — essencial do guarda-roupa, ticket de entrada da marca.

**Descrição completa**  
A Basic Preta é a peça coringa da coleção AEROSTORE: visual limpo, preço acessível e presença forte na vitrine. Pensada para combinar com jeans, calças tech e looks monocromáticos. Parte da linha Basic — mesma linguagem de produto nas cores Off White, Branco, Bege e Brasil.

**Tags / atributos comerciais**  
`linha:basic` · `cor:preto` · `marca:aerostore` · `uso:casual` · `ticket:entrada` · `familia:basic-cores`

**Fotos necessárias**

| Role | Prioridade |
|------|------------|
| Packshot frente (fundo neutro) | Obrigatório |
| Costas ou detalhe | Recomendado |

Arquivo: `camiseta-basic-aerostore-preta--preto--front--01.webp`

**Grade / estoque**  
- Confirmar tamanhos disponíveis (ex.: M–GG — PENDENTE loja).  
- Atenção a estoque baixo na cor preta (alta demanda típica).

**Pendências**  
- [ ] Foto 4:5 · [ ] Grade · [ ] Composição · [ ] Aprovação copy · [ ] FK PDV  

---

### 3.3 Camiseta Basic AEROSTORE — Off White

| Campo | Proposta |
|-------|----------|
| **Nome PDV** | CAMISETA AEROSTORE BASIC CORES OFF WHITE |
| **Nome editorial** | Camiseta Basic AEROSTORE — Off White |
| **Slug** | `camiseta-basic-aerostore-off-white` |
| **Categoria web** | `camisetas` / Camisetas |
| **Preço ref. PDV** | R$ 79,90 |
| **Ordem** | 5 |
| **Cor editorial** | Off white |

**Descrição curta**  
Camiseta Basic off white AEROSTORE — tom claro sofisticado para looks clean.

**Descrição completa**  
Off white traz leveza sem o contraste extremo do branco puro. Peça versátil da linha Basic AEROSTORE, fácil de combinar com calças escuras, bege e denim. Mesmo DNA da Basic Preta: corte limpo, dia a dia e preço de entrada.

**Tags**  
`linha:basic` · `cor:off-white` · `marca:aerostore` · `ticket:entrada` · `familia:basic-cores`

**Fotos**  
Packshot frente obrigatório (`…--off-white--front--01.webp`). Preferir fundo que preserve o tom off white (evitar overexposição).

**Grade / estoque**  
Confirmar tamanhos e status no pool; validar se “Off White” no PDV = tom real da peça fotografada.

**Pendências**  
- [ ] Foto · [ ] Grade · [ ] Composição · [ ] Aprovação · [ ] FK PDV  

---

### 3.4 Camiseta Basic AEROSTORE — Branco

| Campo | Proposta |
|-------|----------|
| **Nome PDV** | CAMISETA AEROSTORE BASIC CORES BRANCO |
| **Nome editorial** | Camiseta Basic AEROSTORE — Branco |
| **Slug** | `camiseta-basic-aerostore-branco` |
| **Categoria web** | `camisetas` / Camisetas |
| **Preço ref. PDV** | R$ 79,90 |
| **Ordem** | 6 |
| **Cor editorial** | Branco |

**Descrição curta**  
Camiseta Basic branca AEROSTORE — clássico limpo para qualquer estação.

**Descrição completa**  
A Basic Branco é o branco essencial da casa: visual limpo, fácil de vestir e forte em combinação com calças e bermudas. Completa a família Basic ao lado das cores Preta, Off White, Bege e Brasil.

**Tags**  
`linha:basic` · `cor:branco` · `marca:aerostore` · `ticket:entrada` · `familia:basic-cores`

**Fotos**  
Packshot frente obrigatório. Cuidado com fundo vs tecido branco (sombra suave / contraste controlado).

**Pendências**  
- [ ] Foto · [ ] Grade · [ ] Composição · [ ] Aprovação · [ ] FK PDV  

---

### 3.5 Camiseta Basic AEROSTORE — Bege

| Campo | Proposta |
|-------|----------|
| **Nome PDV** | CAMISETA AEROSTORE BASIC CORES BEGE |
| **Nome editorial** | Camiseta Basic AEROSTORE — Bege |
| **Slug** | `camiseta-basic-aerostore-bege` |
| **Categoria web** | `camisetas` / Camisetas |
| **Preço ref. PDV** | R$ 79,90 |
| **Ordem** | 7 |
| **Cor editorial** | Bege |

**Descrição curta**  
Camiseta Basic bege AEROSTORE — tom neutro quente para looks contemporâneos.

**Descrição completa**  
Bege é o neutro quente da linha Basic: combina com jeans, preto e looks earth-tone. Mantém o caimento e a proposta acessível da Basic AEROSTORE, com personalidade própria na vitrine.

**Tags**  
`linha:basic` · `cor:bege` · `marca:aerostore` · `ticket:entrada` · `familia:basic-cores`

**Fotos**  
Packshot frente obrigatório (`…--bege--front--01.webp`). Validar tom real (bege vs areia) na aprovação da foto.

**Pendências**  
- [ ] Foto · [ ] Grade · [ ] Composição · [ ] Aprovação · [ ] FK PDV  

---

### 3.6 Camiseta Basic AEROSTORE — Brasil

| Campo | Proposta |
|-------|----------|
| **Nome PDV** | CAMISETA AEROSTORE BASIC CORES BRASIL |
| **Nome editorial** | Camiseta Basic AEROSTORE — Brasil |
| **Slug** | `camiseta-basic-aerostore-brasil` |
| **Categoria web** | `camisetas` / Camisetas |
| **Preço ref. PDV** | R$ 79,90 |
| **Ordem** | 8 |
| **Cor editorial** | Brasil *(confirmar tom real: verde? estampa? nome comercial de cor)* |

**Descrição curta**  
Camiseta Basic AEROSTORE na cor Brasil — destaque de personalidade na linha de entrada.

**Descrição completa**  
A Basic Brasil traz identidade à família Basic sem sair do ticket de entrada. Use o nome editorial “Brasil” apenas se a cor/estampa real corresponder; se o PDV usar “Brasil” como apelido de um tom específico, alinhar copy e foto para não gerar expectativa errada no site.

**Tags**  
`linha:basic` · `cor:brasil` · `marca:aerostore` · `ticket:entrada` · `familia:basic-cores` · `nota:validar-cor-real`

**Fotos**  
Packshot frente obrigatório. **Crítico:** foto deve deixar o tom “Brasil” inequívoco.

**Grade / estoque**  
Confirmar se há estoque suficiente no pool; cor especial pode ter grade mais curta.

**Pendências**  
- [ ] Validar tom/estampa “Brasil” com produto físico  
- [ ] Foto · [ ] Grade · [ ] Composição · [ ] Aprovação · [ ] FK PDV  

---

### 3.7 Camiseta Pima AEROSTORE

| Campo | Proposta |
|-------|----------|
| **Nome PDV** | CAMISETA PIMA AEROSTORE CORES |
| **Nome editorial** | Camiseta Pima AEROSTORE |
| **Slug** | `camiseta-pima-aerostore` |
| **Categoria web** | `camisetas` / Camisetas |
| **Preço ref. PDV** | R$ 199,90 |
| **Destaque** | sim |
| **Ordem** | 2 |

**Descrição curta**  
Camiseta Pima AEROSTORE — toque premium, caimento elevado e presença de vitrine.

**Descrição completa**  
A Pima é o degrau acima na linha de camisetas AEROSTORE: algodão Pima (ou blend com toque Pima — **confirmar composição na loja**), acabamento cuidado e preço alinhado a peça de desejo. Ideal como destaque ao lado da Series Basic e da Calça Tech, formando o trio âncora da primeira vitrine.

**Tags**  
`linha:pima` · `marca:aerostore` · `material:pima` · `ticket:premium` · `featured:true`

**Fotos necessárias**

| Role | Prioridade |
|------|------------|
| Packshot frente | Obrigatório |
| Detalhe tecido / gola | Obrigatório (justifica ticket) |
| Costas ou look | Recomendado |

Arquivos: `camiseta-pima-aerostore--{cor}--front--01.webp`, `…--detail--01.webp`

**Grade / estoque**  
- Listar cores disponíveis (PDV diz “CORES” — mapear cores reais no intake).  
- Se multi-cor, decidir: card único com variantes **ou** cards por cor (hoje 1 produto PDV → 1 card piloto).

**Pendências**  
- [ ] Composição Pima confirmada  
- [ ] Cores reais listadas  
- [ ] Fotos (frente + detalhe)  
- [ ] Grade · [ ] Aprovação · [ ] FK PDV  

---

### 3.8 Calça Tech AEROSTORE 5 Pockets

| Campo | Proposta |
|-------|----------|
| **Nome PDV** | CALÇA TECH AEROSTORE TECNOLÓGICA 5 FIVE POCKET |
| **Nome editorial** | Calça Tech AEROSTORE 5 Pockets |
| **Slug** | `calca-tech-aerostore-5-pockets` |
| **Categoria web** | `calcas` / Calças |
| **Preço ref. PDV** | R$ 397,00 |
| **Destaque** | sim |
| **Ordem** | 3 |

**Descrição curta**  
Calça Tech AEROSTORE com 5 bolsos — modelagem contemporânea e ticket âncora da vitrine.

**Descrição completa**  
A Calça Tech é o bottom de destaque do piloto: linguagem “tech” da casa, cinco bolsos e presença de preço que equilibra a vitrine de camisetas. Combinar copy com benefício real (conforto, caimento, tecido) — evitar jargão vazio. Ideal em look com Series Basic ou Pima.

**Tags**  
`linha:tech` · `categoria:calcas` · `marca:aerostore` · `atributo:5-pockets` · `ticket:ancora` · `featured:true`

**Fotos necessárias**

| Role | Prioridade |
|------|------------|
| Packshot frente (corpo / manequim) | Obrigatório |
| Costas / bolsos | Obrigatório |
| Detalhe tecido / cós | Recomendado |
| Look com camiseta AEROSTORE | Recomendado (coerência de vitrine) |

Arquivos: `calca-tech-aerostore-5-pockets--{cor}--front--01.webp`, `…--back--01.webp`

**Grade / estoque**  
- Confirmar numeração (ex.: 40–46 — PENDENTE).  
- Confirmar cores (PDV não deixa cor no nome — listar no intake).  
- Ticket alto: só publicar se houver grade mínima vendável no pool.

**Pendências**  
- [ ] Cor(es) e numeração  
- [ ] Fotos (frente + costas)  
- [ ] Copy de benefício real (tecido/caimento)  
- [ ] Composição / cuidados  
- [ ] Aprovação · [ ] FK PDV  

---

## 4. Brief de fotos — lote piloto

| # | Slug | Packshot min. | Extra recomendado |
|---|------|---------------|-------------------|
| 1 | `camiseta-series-basic-aerostore` | frente | costas + detalhe |
| 2 | `camiseta-pima-aerostore` | frente + detalhe | costas / look |
| 3 | `calca-tech-aerostore-5-pockets` | frente + costas | detalhe + look |
| 4–8 | Basic (5 cores) | frente por cor | 1 detalhe compartilhado da linha |

**Regras**

- Proporção **4:5**, export web (webp preferencial).  
- Fundo neutro; sem watermark; sem SKU na imagem.  
- Não usar foto de estoque com etiqueta PDV visível.  
- Aprovar tom de Off White / Bege / Brasil com produto físico ao lado.

---

## 5. Checklist global — pronto para Fase 2.9?

| Critério | Status |
|----------|--------|
| 8 nomes editoriais propostos | **Proposto** (aguardando aprovação dono) |
| 8 slugs únicos | **Proposto** |
| Categorias web | **Proposto** (`camisetas` ×7, `calcas` ×1) |
| Copy curta + completa | **Proposto** |
| Tags comerciais | **Proposto** |
| Fotos reais uploadadas | **PENDENTE** |
| Composição / cuidados | **PENDENTE** (loja) |
| Grade por produto confirmada | **PENDENTE** (PDV read-only + loja) |
| `product_id` / `variant_id` mapeados | **PENDENTE** (intake 2.9) |
| `SHOP_PUBLIC_CATALOG_ENABLED` | **OFF** (não ligar nesta fase) |
| Migration SQL | **Não iniciar** até aprovação deste doc + fotos |

---

## 6. Pendências para publicação real (resumo)

### Obrigatórias (bloqueiam 2.9 / go-live)

1. Aprovação humana dos **8 nomes + slugs + copy**.  
2. Sessão de fotos do lote piloto (mínimo: 1 packshot por produto; Tech e Pima com detalhe).  
3. Confirmação de **grade/tamanhos/cores** no pool de fulfillment.  
4. Composição e cuidados (pelo menos nas 3 peças destaque).  
5. Validação especial da cor **Brasil** (tom real vs expectativa).  
6. Mapeamento FK PDV (`product_id` / variantes) no intake — sem duplicar SKU/estoque na tabela shop.

### Recomendadas (qualidade)

7. Look da Calça Tech + Series ou Pima (coerência visual).  
8. Decisão futura: Basic multi-cor como 1 PDP vs 5 cards (hoje: 5 cards).  
9. SEO title/description finais (podem derivar do nome editorial + descrição curta).

### Explicitamente fora desta fase

- Ligar catálogo público  
- Migration / DDL  
- Carrinho, checkout, pagamento, reserva de estoque  
- Alterar PDV, Argox, WhatsApp, cashback  

---

## 7. Mapa nome PDV → editorial → slug

| # | Nome PDV | Nome editorial | Slug |
|---|----------|----------------|------|
| 1 | CAMISETA AEROSTORE SERIES BASIC | Camiseta Series Basic AEROSTORE | `camiseta-series-basic-aerostore` |
| 2 | CAMISETA AEROSTORE BASIC CORES PRETO | Camiseta Basic AEROSTORE — Preta | `camiseta-basic-aerostore-preta` |
| 3 | CAMISETA AEROSTORE BASIC CORES OFF WHITE | Camiseta Basic AEROSTORE — Off White | `camiseta-basic-aerostore-off-white` |
| 4 | CAMISETA AEROSTORE BASIC CORES BRANCO | Camiseta Basic AEROSTORE — Branco | `camiseta-basic-aerostore-branco` |
| 5 | CAMISETA AEROSTORE BASIC CORES BEGE | Camiseta Basic AEROSTORE — Bege | `camiseta-basic-aerostore-bege` |
| 6 | CAMISETA AEROSTORE BASIC CORES BRASIL | Camiseta Basic AEROSTORE — Brasil | `camiseta-basic-aerostore-brasil` |
| 7 | CAMISETA PIMA AEROSTORE CORES | Camiseta Pima AEROSTORE | `camiseta-pima-aerostore` |
| 8 | CALÇA TECH AEROSTORE TECNOLÓGICA 5 FIVE POCKET | Calça Tech AEROSTORE 5 Pockets | `calca-tech-aerostore-5-pockets` |

---

## 8. Referências

- [shop-phase-2.8.3-pilot-selection.md](./shop-phase-2.8.3-pilot-selection.md) — seleção Grupo A  
- [shop-real-catalog-blueprint.md](./shop-real-catalog-blueprint.md) — blueprint editorial vs PDV  
- [shop-schema-design.md](./shop-schema-design.md) — publication layer espelho  
- [ecommerce-architecture.md](./ecommerce-architecture.md) — ADR  
- `modules/shop/config/real-catalog-intake.template.json` — template de intake (preencher na sequência, sem publicar)

---

## 9. Confirmações desta entrega

| Item | Status |
|------|--------|
| Arquivo | `docs/architecture/shop-phase-2.8.4-editorial-pilot.md` (**criado**) |
| Código / JS / CSS | **Não alterado** |
| Banco / migration | **Não** |
| Deploy / VPS | **Não** |
| Catálogo público | **OFF** |
| Commit | **Não** (aguardando aprovação) |
