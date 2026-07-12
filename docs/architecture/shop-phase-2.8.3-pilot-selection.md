# Shop Fase 2.8.3 — Seleção dos primeiros produtos reais (vitrine piloto)

**Data:** 2026-07-11 (atualizado com prints VPS)  
**Modo:** Investigação **100% read-only** — sem código, banco, deploy, migration ou publicação.  
**Catálogo público:** `SHOP_PUBLIC_CATALOG_ENABLED` permanece **OFF**.  
**Fonte:** prints reais de `/shop/publicacao` na VPS (Fase 2.8.2 deployada) + curadoria humana AEROSTORE.

---

## 1. Resumo executivo

A Fase 2.8.2 entregou curadoria read-only em `/shop/publicacao`. Na **VPS em produção** (prints confirmados):

| KPI | VPS (produção) |
|-----|----------------|
| Total bruto PDV | **65** |
| Ocultos QA/teste | **36** |
| Candidatos limpos | **29** |
| Publicáveis potenciais | **17** |
| Vendáveis (limpos) | **17** |
| Em estoque | **12** |
| Estoque baixo | **6** |

**Conclusão:** entre os **17 publicáveis potenciais**, a curadoria identificou **8 peças AEROSTORE** para a **primeira vitrine piloto** — foco em camisetas da casa + uma calça tech. Nenhuma está pronta para publicação imediata: falta camada editorial completa (foto, slug, categoria, descrição, nome comercial).

**Princípios registrados (curadoria VPS):**

1. A primeira vitrine deve priorizar **identidade AEROSTORE**, não virar listagem de estoque.
2. Os nomes PDV precisam de **camada editorial** antes de publicar.
3. Antes da **Fase 2.9**, cada peça do Grupo A ainda exige: **foto**, **slug**, **categoria**, **descrição**, **nome comercial** e **revisão de grade/estoque**.
4. **Próxima fase:** **Fase 2.8.4 — Preparação editorial da vitrine piloto**.

**Próxima fase técnica:** **Fase 2.9** (migration/publicação) somente após intake + fotos + copy aprovados.

---

## 2. Metodologia e fontes

### 2.1 Critério “Publicável potencial” (Fase 2.8.2)

`is_potentially_publishable = true` quando: não QA · produto ativo · variação ativa · vendável · `in_stock` ou `low_stock` · preço > 0.

Pool: **`vila`, `botanico`, `sul`** · `min_across_stores` · limiar estoque baixo **2**.

### 2.2 Rubrica aplicada nos prints VPS

| Grupo | Critério |
|-------|----------|
| **A — Primeira vitrine** | Marca AEROSTORE, nome comercializável, estoque vendável, fit com posicionamento premium |
| **B — Segunda leva** | Produto real, mas nome/copy/grade/foto precisam revisão ou diluem foco |
| **C — Não recomendado agora** | Bloqueado/indisponível, nome técnico, marca avulsa, sobra sem grade/foto/copy |

### 2.3 Fonte

- Prints `/shop/publicacao` na VPS (KPIs + filtro **Publicáveis potenciais** + coluna **Motivo**)
- Curadoria humana sobre os 17 candidatos limpos observados

---

## 3. Curadoria nominal — publicáveis potenciais (VPS)

Dos **17 publicáveis potenciais**, a seleção editorial resultou em:

| Grupo | Qtd | Destino |
|-------|-----|---------|
| Primeira vitrine piloto | **8** | Fase 2.8.4 → futura 2.9 |
| Segunda leva / revisar | **8** | Intake posterior |
| Não recomendado agora | **restante + bloqueados** | Fora do piloto inicial |

---

## 4. Tabela — primeira vitrine piloto (8 produtos)

**Grupo A** — recomendados para publicação editorial (ainda **sem publicar**).

| # | Nome PDV (VPS) | Preço PDV | Categoria | Grupo | Nome editorial sugerido |
|---|----------------|-----------|-----------|-------|---------------------------|
| 1 | CAMISETA AEROSTORE SERIES BASIC | R$ 129,90 | camisetas | **A** | Camiseta Series Basic AEROSTORE |
| 2 | CAMISETA AEROSTORE BASIC CORES PRETO | R$ 79,90 | camisetas | **A** | Camiseta Basic AEROSTORE — Preta |
| 3 | CAMISETA AEROSTORE BASIC CORES OFF WHITE | R$ 79,90 | camisetas | **A** | Camiseta Basic AEROSTORE — Off White |
| 4 | CAMISETA AEROSTORE BASIC CORES BRANCO | R$ 79,90 | camisetas | **A** | Camiseta Basic AEROSTORE — Branco |
| 5 | CAMISETA AEROSTORE BASIC CORES BEGE | R$ 79,90 | camisetas | **A** | Camiseta Basic AEROSTORE — Bege |
| 6 | CAMISETA AEROSTORE BASIC CORES BRASIL | R$ 79,90 | camisetas | **A** | Camiseta Basic AEROSTORE — Brasil |
| 7 | CAMISETA PIMA AEROSTORE CORES | R$ 199,90 | camisetas | **A** | Camiseta Pima AEROSTORE — Cores |
| 8 | CALÇA TECH AEROSTORE TECNOLÓGICA 5 FIVE POCKET | R$ 397,00 | calças | **A** | Calça Tech AEROSTORE 5 Pockets |

**Mix da vitrine:** 7 camisetas AEROSTORE (Basic + Series + Pima) + 1 calça tech — coerente com identidade de marca, ticket variado (R$ 79,90 – R$ 397,00).

### 4.1 O que falta em cada item do Grupo A (antes da Fase 2.9)

| Item | Status | Ação Fase 2.8.4 |
|------|--------|-----------------|
| **Foto** | Pendente | Packshot 4:5 — `shop-product-photo-guide.md` |
| **Slug** | Pendente | Ex.: `camiseta-basic-aerostore-preta` |
| **Categoria** | Inferida | Validar taxonomia shop |
| **Descrição** | Pendente | Copy curta + completa + composição/cuidados |
| **Nome comercial** | PDV técnico | Aplicar nomes editoriais da tabela acima |
| **Grade/estoque** | Read-only OK | Revisar variações ativas; confirmar `low_stock` vs `in_stock` |

---

## 5. Segunda leva — revisar antes de incluir

**Grupo B** — bons produtos ou candidatos reais, mas **não entram na primeira vitrine** (foco, nome, foto ou posicionamento).

| Nome PDV (VPS) | Motivo da segunda leva |
|----------------|------------------------|
| CAMISETA INSIDER BASIC CORES | Marca terceira (Insider) — dilui vitrine AEROSTORE no lançamento |
| CAMISETA BRASIL AEROSTORE WORD CUP SERIES | Sazonal/campanha — revisar timing e copy antes do piloto |
| CAMISETA AEROSTORE BASIC CORES VERDE | Variante Basic válida; incluir na **2ª leva** para não inflar 8 slots de camiseta |
| CAMISETA AEROSTORE BASIC CORES CINZA | Idem |
| CAMISETA AEROSTORE BASIC CORES MARSALA | Idem |
| MOLETINHO CK COM CAPUZ | Marca avulsa (CK); enfraquece primeira vitrine própria |
| Camisa Wollner Mc Variadas Claro | Marca avulsa; nome técnico; precisa foto/copy |
| CALCA MARIA FILO MILOS | Marca avulsa; fora do posicionamento AEROSTORE inicial |

**Ação:** manter no radar para expansão pós-piloto (vitrine 12–16 peças), após validação operacional da primeira leva.

---

## 6. Não recomendado para e-commerce agora

**Grupo C** — critérios explícitos da curadoria (prints VPS + candidatos limpos fora dos 17 potenciais):

- Itens **bloqueados / indisponíveis** (sem estoque no pool, inativo, sem variação ativa)
- Itens com **nome muito técnico** (CAIXA ALTA crua, códigos, referências internas PDV)
- Itens de **marcas avulsas** que enfraquecem a primeira vitrine (ex.: Insider, CK, Wollner, Maria Filo na leva inicial)
- **Produtos de sobra** sem boa grade, foto ou copy viável

| Tipo | Detalhe operacional |
|------|---------------------|
| Bloqueados / indisponíveis | Entre os **12** candidatos limpos fora dos 17 potenciais |
| Nome técnico | Não publicar título PDV cru na vitrine |
| Marca avulsa (1ª vitrine) | Reservar para 2ª leva ou expansão |
| Sobra operacional | Grade incompleta, estoque residual, sem assets |

**Regra:** estes itens permanecem no PDV; **não entram** na projeção shop até curadoria + dados editoriais.

---

## 7. Diretrizes editoriais (obrigatórias antes de publicar)

### 7.1 Identidade

1. A primeira vitrine prioriza **AEROSTORE**, não listagem de estoque.
2. Nomes PDV são **referência operacional** — a vitrine usa **nome comercial** + cor/linha legível.
3. Evitar repetir “CORES”, “TECNOLÓGICA”, “FIVE POCKET” no título público.

### 7.2 Exemplos nome PDV → nome editorial

| Nome PDV | Nome editorial sugerido |
|----------|------------------------|
| CAMISETA AEROSTORE BASIC CORES PRETO | Camiseta Basic AEROSTORE — Preta |
| CAMISETA AEROSTORE BASIC CORES OFF WHITE | Camiseta Basic AEROSTORE — Off White |
| CAMISETA AEROSTORE BASIC CORES BRANCO | Camiseta Basic AEROSTORE — Branco |
| CAMISETA AEROSTORE BASIC CORES BEGE | Camiseta Basic AEROSTORE — Bege |
| CAMISETA PIMA AEROSTORE CORES | Camiseta Pima AEROSTORE — Cores |
| CALÇA TECH AEROSTORE TECNOLÓGICA 5 FIVE POCKET | Calça Tech AEROSTORE 5 Pockets |

---

## 8. Produtos fora dos 17 potenciais

**12 candidatos limpos** não classificados como publicáveis potenciais (29 − 17):

| Motivo típico | Ação |
|---------------|------|
| Sem estoque no pool | Repor ou excluir do e-commerce |
| Produto inativo | Reativar só se voltar à loja |
| Sem variação ativa / preço inválido | Corrigir cadastro PDV (fora escopo shop) |

Estes **não** entram na vitrine piloto até passarem no filtro read-only.

---

## 9. Regra de estoque — adequada para piloto

Política `min_across_stores` + limiar **2** permanece **adequada** para piloto (anti-overselling). Maioria dos 17 potenciais aparece como **Vendável**; **12 em estoque** / **6 estoque baixo** nos KPIs — revisar grade por peça na 2.8.4 antes de expor publicamente.

---

## 10. Riscos antes da publicação real

| Risco | Mitigação |
|-------|-----------|
| Vitrine parecer “dump” de estoque | Curadoria AEROSTORE-only na 1ª leva |
| Nome PDV na vitrine | Camada editorial 2.8.4 |
| Sem foto | Obrigatório antes 2.9 |
| Marcas avulsas no lançamento | Segunda leva |
| Migration prematura | Só 2.9 após intake |
| Catálogo público cedo | Manter `SHOP_PUBLIC_CATALOG_ENABLED=false` |

---

## 11. Próxima fase

### Fase 2.8.4 — Preparação editorial da vitrine piloto (recomendada)

1. Preencher intake dos **8 produtos Grupo A** (`real-catalog-intake.template.json`)
2. Produzir fotos (guia shop)
3. Definir slug, categoria, descrição, nome comercial
4. Revisar grade/estoque por variação
5. Aprovação humana antes de qualquer DDL

### Fase 2.9 — Migration + publicação (depois)

Somente após intake + fotos + copy aprovados.

**Sequência:** **2.8.4 → 2.9 → liberar catálogo público**.

---

## 12. Validações desta entrega

| Verificação | Resultado |
|-------------|-----------|
| Alteração de código | **Nenhuma** |
| Banco / migration / deploy | **Nenhum** |
| Commit | **Nenhum** (aguardando aprovação) |
| Arquivo alterado | Apenas este markdown |

---

## 13. Anexo — distribuição VPS (prints)

```
65 total bruto
├── 36 ocultos QA/teste
└── 29 candidatos limpos
    ├── 17 publicáveis potenciais
    │   ├── 8 → primeira vitrine (Grupo A)
    │   └── 9 → segunda leva + não recomendados (curadoria)
    └── 12 bloqueados operacionalmente (fora do piloto)
```

Taxa limpo → potencial: **59%**. Primeira vitrine: **8/17** potenciais (**47%** do pool curado) — seleção intencionalmente restrita para qualidade de marca.
