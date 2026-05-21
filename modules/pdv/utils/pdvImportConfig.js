"use strict";

const PDV_IMPORT_TYPES = [
  {
    key: "produtos",
    label: "Produtos",
    accept: ".xlsx,.xls,.csv",
    description: "Cadastre ou atualize a base operacional de produtos do PDV com cabeçalho flexível e preview completo.",
    requiredFields: ["sku_or_codigo", "nome", "marca", "categoria", "cor", "tamanho", "preco_venda"],
    keyField: "sku_or_codigo",
    aliases: {
      codigo: ["codigo", "código", "cod", "cód", "sku", "referencia", "referência", "ref"],
      sku: ["sku", "codigo", "código", "referencia", "referência", "ref"],
      nome: ["produto", "nome", "descricao", "descrição", "descrição produto", "produto nome"],
      descricao: ["descricao", "descrição", "descricao opcional", "observacao produto", "observação produto"],
      marca: ["marca", "brand"],
      categoria: ["categoria", "grupo", "tipo", "departamento", "linha"],
      tipo: ["tipo", "subtipo", "familia", "família"],
      cor: ["cor", "color"],
      tamanho: ["tamanho", "tam", "size"],
      preco_venda: ["preco", "preço", "preco venda", "preço venda", "valor venda", "valor"],
      preco_custo: ["custo", "preco custo", "preço custo", "valor custo"],
      estoque: ["estoque", "saldo", "qtd estoque", "quantidade estoque"],
      status: ["status", "situacao", "situação"]
    }
  },
  {
    key: "clientes",
    label: "Clientes",
    accept: ".xlsx,.xls,.csv",
    description: "Consolide clientes do PDV com telefone como chave principal anti-duplicidade.",
    requiredFields: ["nome", "telefone"],
    keyField: "telefone",
    aliases: {
      nome: ["nome", "cliente", "razao social", "razão social"],
      telefone: ["telefone", "fone", "celular", "whatsapp", "telefone principal"],
      cpf: ["cpf", "cnpj", "cpf cnpj", "documento", "cnpj cpf"],
      email: ["email", "e-mail", "mail"],
      data_nascimento: ["data nascimento", "nascimento", "data_nasc", "data de nascimento"],
      cidade: ["cidade", "municipio", "município"],
      loja_origem: ["loja", "loja origem", "origem loja", "store"]
    }
  },
  {
    key: "vendas",
    label: "Vendas históricas",
    accept: ".xlsx,.xls,.csv",
    description: "Importe vendas históricas para alimentar recorrência, ticket médio e comportamento comercial.",
    requiredFields: ["data_venda", "cliente", "telefone", "vendedor", "loja", "valor_total", "forma_pagamento"],
    keyField: "telefone",
    aliases: {
      data_venda: ["data venda", "data", "emissao", "emissão", "data venda compra"],
      cliente: ["cliente", "nome", "comprador"],
      telefone: ["telefone", "fone", "celular", "whatsapp"],
      vendedor: ["vendedor", "consultor", "seller"],
      loja: ["loja", "store", "filial"],
      valor_total: ["valor total", "total", "valor", "ticket", "valor venda"],
      forma_pagamento: ["forma pagamento", "pagamento", "forma pgto", "meio pagamento"],
      produtos: ["produtos", "itens", "descricao produtos", "descrição produtos"],
      observacao: ["observacao", "observação", "obs", "comentario", "comentário"]
    }
  },
  {
    key: "curva-abc",
    label: "Curva ABC",
    accept: ".xlsx,.xls,.csv",
    description: "Enriqueça o PDV com classe ABC, total comprado, ticket médio e última compra por cliente.",
    requiredFields: ["cliente", "telefone", "classe_abc", "total_comprado", "quantidade_compras", "ticket_medio", "ultima_compra"],
    keyField: "telefone",
    aliases: {
      cliente: ["cliente", "nome", "comprador"],
      telefone: ["telefone", "fone", "celular", "whatsapp"],
      classe_abc: ["classe abc", "abc", "classificacao", "classificação", "curva abc"],
      total_comprado: ["total comprado", "valor", "total", "faturamento"],
      quantidade_compras: ["quantidade compras", "compras", "qtd compras", "numero compras", "número compras"],
      ticket_medio: ["ticket medio", "ticket médio", "ticket", "media compra", "média compra"],
      ultima_compra: ["ultima compra", "última compra", "data ultima compra", "data última compra"]
    }
  },
  {
    key: "cashback",
    label: "Cashback",
    accept: ".xlsx,.xls,.csv",
    description: "Migre saldos iniciais de cashback com histórico auditável e sem tratar saldo como desconto.",
    requiredFields: ["cliente", "telefone", "saldo_cashback"],
    keyField: "telefone",
    aliases: {
      cliente: ["cliente", "nome", "comprador"],
      telefone: ["telefone", "fone", "celular", "whatsapp"],
      saldo_cashback: ["saldo cashback", "cashback", "saldo", "valor cashback"],
      validade: ["validade", "vence em", "expira em", "data validade"],
      origem: ["origem", "fonte", "sistema origem"]
    }
  }
];

function getPdvImportTypeConfig(type) {
  return PDV_IMPORT_TYPES.find((item) => item.key === String(type || "").trim()) || null;
}

module.exports = {
  PDV_IMPORT_TYPES,
  getPdvImportTypeConfig
};
