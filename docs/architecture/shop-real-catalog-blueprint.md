# Blueprint — Primeira vitrine real AEROSTORE

**Fase 2.4** · Planejamento · **sem estoque, SKU ou banco**  
**Revisão:** 2026-07-11 — alinhado à publication layer espelho (pré-Fase 2.9)

Objetivo: definir quais produtos reais entram na primeira vitrine online read-only, em que ordem e com quais dados você precisa providenciar.

**Seleção piloto curada (8 produtos Grupo A):** ver [shop-phase-2.8.3-pilot-selection.md](./shop-phase-2.8.3-pilot-selection.md).

---

## Publication layer — o que vai para SQL vs o que fica no PDV

Na Fase 2.9, cada peça da vitrine gera **somente** metadados editoriais em `shop_*`. Cadastro operacional permanece no PDV.

| Você providencia (editorial) | PDV já tem (não duplicar em shop) |
|------------------------------|-----------------------------------|
| Nome comercial / editorial | Nome interno PDV |
| Slug público | `product_id`, `variant_id` (FK) |
| Categoria web | SKU, barcode |
| Descrição curta/completa | Custo, margem |
| Fotos / galeria | Estoque numérico por loja |
| Preço web (se override) | Preço base PDV (default na projeção) |
| Destaque, ordem, SEO | Tiny ID, notas internas |

Disponibilidade pública (`in_stock` / `low_stock` / `out_of_stock`) é **calculada** na projeção — nunca persistida como saldo na tabela de publicação.

## Prioridade de categorias (lançamento)

Ordem recomendada para **primeira vitrine real** (12–16 peças):

| Prioridade | Categoria | Por quê |
|------------|-----------|---------|
| 1 | **Camisetas** | Alto giro, foto simples, ticket de entrada |
| 2 | **Polos** | Cara AEROSTORE, combina com chino/bermuda |
| 3 | **Calças** | Complementa looks; chino e jeans são core |
| 4 | **Bermudas** | Sazonal forte em RP; foto rápida |
| 5 | **Calçados** | Destaque visual; exige mais cuidado na foto |
| 6 | **Acessórios** | Complemento de ticket (cinto); entrar por último |

**Não lançar primeiro:** categorias que dependem de grade complexa ou foto difícil sem preparação (ex.: muitas cores de calçado sem fotos por cor).

---

## Vitrine sugerida — 16 produtos reais (modelo)

Produtos **sugeridos como estrutura**, não como estoque confirmado. Você marca quais existem de fato na loja e substitui nomes comerciais reais.

### Camisetas (3)
| # | Nome sugerido | Faixa preço | Cores | Tamanhos |
|---|---------------|-------------|-------|----------|
| 1 | Camiseta Premium Algodão Branca | R$ 139–159 | Branco, Preto | M–GG |
| 2 | Camiseta Premium Grafite | R$ 139–159 | Grafite | M–GG |
| 3 | Camiseta Básica Gola V Marinho | R$ 119–139 | Marinho | M–G |

### Polos (3)
| # | Nome sugerido | Faixa preço | Cores | Tamanhos |
|---|---------------|-------------|-------|----------|
| 4 | Polo Pima Marinho | R$ 189–219 | Marinho, Branco | M–GG |
| 5 | Polo Pima Branco | R$ 189–219 | Branco | M–GG |
| 6 | Polo Malha Fria Verde Escuro | R$ 169–199 | Verde | M–G |

### Calças (3)
| # | Nome sugerido | Faixa preço | Cores | Tamanhos |
|---|---------------|-------------|-------|----------|
| 7 | Calça Chino Slim Azul Petróleo | R$ 269–299 | Petróleo, Areia | 40–46 |
| 8 | Calça Jeans Slim Escura | R$ 249–279 | Indigo | 40–46 |
| 9 | Calça Sarja Reta Areia | R$ 259–289 | Areia | 40–44 |

### Bermudas (2)
| # | Nome sugerido | Faixa preço | Cores | Tamanhos |
|---|---------------|-------------|-------|----------|
| 10 | Bermuda Chino Sarja Areia | R$ 199–229 | Areia, Petróleo | 40–46 |
| 11 | Bermuda Jeans Destroyed Média | R$ 219–249 | Azul médio | 40–44 |

### Calçados (3)
| # | Nome sugerido | Faixa preço | Cores | Numeração |
|---|---------------|-------------|-------|-----------|
| 12 | Tênis Nobuck Cognac | R$ 349–399 | Cognac | 39–42 |
| 13 | Mocassim Camurça Caramelo | R$ 379–429 | Caramelo | 39–42 |
| 14 | Sapato Derby Preto | R$ 399–449 | Preto | 39–42 |

### Acessórios (2)
| # | Nome sugerido | Faixa preço | Cores | Tamanhos |
|---|---------------|-------------|-------|----------|
| 15 | Cinto Couro Cognac | R$ 119–149 | Cognac, Preto | 95–110 |
| 16 | Meia Premium Pack 3 pares | R$ 69–89 | Sortido | Único |

---

## Vitrine mínima viável — 10 produtos

Se quiser lançar mais rápido, priorizar:

1. Camiseta Premium Branca  
2. Camiseta Premium Grafite  
3. Polo Pima Marinho  
4. Calça Chino Slim Petróleo  
5. Calça Jeans Slim Escura  
6. Bermuda Chino Areia  
7. Tênis Nobuck Cognac  
8. Mocassim Camurça Caramelo  
9. Cinto Couro Cognac  
10. Polo Pima Branco  

Isso cobre todas as categorias principais com foto e copy gerenciáveis.

---

## O que NÃO fazer nesta fase

- Não inventar quantidade em estoque
- Não expor SKU, código Tiny ou custo
- Não prometer compra online
- Não publicar produto sem foto real no padrão do [shop-product-photo-guide.md](./shop-product-photo-guide.md)

---

## Campos por produto (checklist operacional)

Para cada peça real que entrar na vitrine, providenciar:

| Campo | Obrigatório | Quem define |
|-------|-------------|-------------|
| Nome comercial | Sim | Loja / comprador |
| Slug público | Sim | Sistema (gerado do nome) |
| Categoria | Sim | Loja |
| Preço de venda | Sim | Loja |
| Preço promocional | Não | Loja |
| Descrição curta (1–2 linhas) | Sim | Loja |
| Descrição completa | Recomendado | Loja |
| Cores disponíveis | Sim | Loja |
| Tamanhos disponíveis | Sim | Loja |
| Foto principal | Sim | Foto / você |
| Galeria (2–4 fotos) | Recomendado | Foto / você |
| Destaque (sim/não) | Sim | Loja |
| Ordem na vitrine | Sim | Loja |
| Cuidados / composição | Opcional | Loja |
| Tabela de medidas | Opcional | Loja |
| Disponibilidade pública | Sim | `in_stock` / `low_stock` / `out_of_stock` (sem número) |

---

## O que você precisa providenciar (resumo)

### Conteúdo
- [ ] Lista final de 10–16 produtos **que existem de fato** nas lojas
- [ ] Nome comercial e preço de cada um
- [ ] Cores e tamanhos reais por produto
- [ ] Descrição curta + completa (pode ser em planilha)
- [ ] Quais são destaque na vitrine
- [ ] Ordem de exibição desejada

### Fotos
- [ ] Sessão de fotos no padrão 4:5 (ver guia)
- [ ] Pelo menos 1 foto principal por produto
- [ ] Ideal: galeria com detalhe para polos, calças e calçados

### Medidas / cuidados (opcional na 2.4)
- [ ] Composição do tecido (% algodão, etc.)
- [ ] Instruções de lavagem
- [ ] Tabela de medidas (peito, comprimento, cintura) por tamanho

### Decisão de negócio (sem pressa de banco)
- [ ] Quais lojas atendem consulta online (fulfillment futuro)
- [ ] Política de “últimas unidades” vs “consultar na loja”

---

## Mapeamento para SQL futuro (Fase 2.9)

Quando houver migration, cada item deste blueprint (ou do Grupo A da 2.8.3) vira **espelho editorial**:

- `shop_product_publications` — `product_id` + slug, título/descrição editorial, categoria web, SEO, ordem, featured
- `shop_variant_publications` — `variant_id` + slug variante, override de preço web opcional
- `shop_product_images` — galeria editorial

**Não criar colunas** para SKU, barcode, estoque ou custo na publicação — join/consulta PDV na projeção.

Até lá, JSON piloto / intake editorial espelha essa separação.

Schema completo: [shop-schema-design.md](./shop-schema-design.md).

---

## Próxima fase sugerida (2.8.4 → 2.9)

1. Intake editorial dos **8 produtos Grupo A** (2.8.3)
2. Fotos reais no padrão do guia
3. Slug, categoria, descrição, nome comercial aprovados
4. **Fase 2.9:** migration da publication layer (espelho) — ver checklist em [shop-schema-design.md](./shop-schema-design.md)
5. Ainda sem carrinho, checkout, reserva de estoque ou pagamento (Fases 5–8)
