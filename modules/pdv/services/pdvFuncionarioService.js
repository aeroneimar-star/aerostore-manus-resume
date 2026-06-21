"use strict";
// ─── Fase 1: Serviço de funcionários e config — desconto em folha ───
// Escopo: APENAS leitura/escrita de funcionários, exceções e config.
// NÃO contém lógica de pagamento, venda ou caixa.

const { get, all, run } = require("../../../db");
const { appendAuditLog } = require("./pdvControlService");

// ─── Funcionários ───────────────────────────────────────────────────

async function listFuncionarios(filters = {}) {
  const { status, search } = filters;
  let sql = "SELECT * FROM funcionarios WHERE 1=1";
  const params = [];
  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }
  if (search) {
    sql += " AND (nome LIKE ? OR documento LIKE ? OR funcao LIKE ?)";
    const term = `%${search}%`;
    params.push(term, term, term);
  }
  sql += " ORDER BY nome ASC";
  const rows = await all(sql, params);
  return rows.map(sanitizeFuncionario);
}

async function getFuncionarioById(id) {
  const row = await get("SELECT * FROM funcionarios WHERE id = ?", [id]);
  return row ? sanitizeFuncionario(row) : null;
}

async function createFuncionario(data = {}, user = {}) {
  const now = new Date().toISOString();
  const result = await run(
    `INSERT INTO funcionarios
     (nome, documento, data_admissao, status, funcao, loja, user_id, seller_id, telefone, email, observacoes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.nome || "",
      data.documento || "",
      data.data_admissao || "",
      data.status || "ativo",
      data.funcao || "",
      data.loja || "",
      data.user_id || null,
      data.seller_id || null,
      data.telefone || "",
      data.email || "",
      data.observacoes || "",
      now, now
    ]
  );
  const created = await getFuncionarioById(result.lastID);
  appendAuditLog({
    audit_id: `AUD_${Date.now()}_FUNC`,
    action: "FUNCIONARIO_CRIADO",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: user?.role || "",
    reason: "Criação de funcionário no PDV",
    before: null,
    after: created
  });
  return created;
}

async function updateFuncionario(id, data = {}, user = {}) {
  const before = await getFuncionarioById(id);
  if (!before) {
    throw new Error("Funcionário não encontrado.");
  }
  const now = new Date().toISOString();
  await run(
    `UPDATE funcionarios SET
     nome = COALESCE(?, nome),
     documento = COALESCE(?, documento),
     data_admissao = COALESCE(?, data_admissao),
     status = COALESCE(?, status),
     funcao = COALESCE(?, funcao),
     loja = COALESCE(?, loja),
     user_id = COALESCE(?, user_id),
     seller_id = COALESCE(?, seller_id),
     telefone = COALESCE(?, telefone),
     email = COALESCE(?, email),
     observacoes = COALESCE(?, observacoes),
     updated_at = ?
     WHERE id = ?`,
    [
      data.nome,
      data.documento,
      data.data_admissao,
      data.status,
      data.funcao,
      data.loja,
      data.user_id,
      data.seller_id,
      data.telefone,
      data.email,
      data.observacoes,
      now,
      id
    ]
  );
  const after = await getFuncionarioById(id);
  appendAuditLog({
    audit_id: `AUD_${Date.now()}_FUNC`,
    action: "FUNCIONARIO_ATUALIZADO",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: user?.role || "",
    reason: "Atualização de funcionário no PDV",
    before,
    after
  });
  return after;
}

// ─── Exceções ───────────────────────────────────────────────────────

async function listFuncionarioExcecoes(filters = {}) {
  const { ativo } = filters;
  let sql = `SELECT e.*, f.nome as funcionario_nome
             FROM funcionarios_excecoes e
             JOIN funcionarios f ON f.id = e.funcionario_id
             WHERE 1=1`;
  const params = [];
  if (ativo !== undefined) {
    sql += " AND e.ativo = ?";
    params.push(ativo);
  }
  sql += " ORDER BY e.created_at DESC";
  return all(sql, params);
}

async function createFuncionarioExcecao(data = {}, user = {}) {
  const now = new Date().toISOString();
  const func = await getFuncionarioById(data.funcionario_id);
  if (!func) {
    throw new Error("Funcionário não encontrado.");
  }
  const existing = await all(
    `SELECT id FROM funcionarios_excecoes WHERE funcionario_id = ? AND tipo = ? AND ativo = 1`,
    [data.funcionario_id, data.tipo || "carencia_ignorada"]
  );
  if (existing.length > 0) {
    throw new Error("Funcionário já possui exceção ativa deste tipo.");
  }
  const result = await run(
    `INSERT INTO funcionarios_excecoes
     (funcionario_id, tipo, motivo, autorizado_por, autorizado_em, expires_at, ativo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.funcionario_id,
      data.tipo || "carencia_ignorada",
      data.motivo || "",
      user?.name || user?.email || "sistema",
      now,
      data.expires_at || "",
      1,
      now
    ]
  );
  const created = await get("SELECT * FROM funcionarios_excecoes WHERE id = ?", [result.lastID]);
  appendAuditLog({
    audit_id: `AUD_${Date.now()}_EXC`,
    action: "FUNCIONARIO_EXCECAO_CRIADA",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: user?.role || "",
    reason: `Exceção criada para ${func.nome}: ${data.motivo || ""}`,
    before: null,
    after: created
  });
  return created;
}

async function isFuncionarioExcecao(funcionarioId, tipo = "carencia_ignorada") {
  const row = await get(
    `SELECT id FROM funcionarios_excecoes
     WHERE funcionario_id = ? AND tipo = ? AND ativo = 1
       AND (expires_at IS NULL OR expires_at = '' OR datetime(expires_at) > datetime('now'))
     LIMIT 1`,
    [funcionarioId, tipo]
  );
  return Boolean(row?.id);
}

// ─── Config ─────────────────────────────────────────────────────────

async function getDescontoFolhaConfig() {
  const rows = await all("SELECT * FROM desconto_folha_config ORDER BY parametro ASC");
  const config = {};
  for (const row of rows) {
    config[row.parametro] = row.valor;
  }
  return config;
}

async function updateDescontoFolhaConfig(parametro, valor, user = {}) {
  const now = new Date().toISOString();
  const existing = await get("SELECT * FROM desconto_folha_config WHERE parametro = ?", [parametro]);
  if (!existing) {
    throw new Error(`Parâmetro '${parametro}' não encontrado na configuração de desconto em folha.`);
  }
  await run(
    `UPDATE desconto_folha_config SET valor = ?, atualizado_por = ?, updated_at = ? WHERE parametro = ?`,
    [valor, user?.name || user?.email || "sistema", now, parametro]
  );
  appendAuditLog({
    audit_id: `AUD_${Date.now()}_CFG`,
    action: "DESCONTO_FOLHA_CONFIG_ATUALIZADO",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: user?.role || "",
    reason: `Config '${parametro}' alterado para: ${valor}`,
    before: { parametro, valor: existing.valor },
    after: { parametro, valor }
  });
  return getDescontoFolhaConfig();
}

async function saveChequePagamento(data = {}, user = {}) {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO cheque_pagamentos
      (venda_id, cliente_id, banco, numero_cheque, data_cheque, valor, observacao, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.venda_id || "",
      data.cliente_id || "",
      data.banco || "",
      data.numero_cheque || "",
      data.data_cheque || "",
      data.valor || 0,
      data.observacao || "",
      now
    ]
  );
  appendAuditLog({
    audit_id: `AUD_${Date.now()}_CHEQUE`,
    action: "CHEQUE_PAGAMENTO_REGISTRADO",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: user?.role || "",
    reason: `Cheque R$ ${data.valor} na venda ${data.venda_id}`,
    before: null,
    after: data
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

function sanitizeFuncionario(row = {}) {
  return {
    id: row.id,
    nome: row.nome,
    documento: row.documento || "",
    data_admissao: row.data_admissao || "",
    status: row.status,
    funcao: row.funcao || "",
    loja: row.loja || "",
    user_id: row.user_id || null,
    seller_id: row.seller_id || null,
    telefone: row.telefone || "",
    email: row.email || "",
    observacoes: row.observacoes || "",
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

// ─── Desconto em Folha ──────────────────────────────────────────────

/**
 * Salva uma parcela de desconto em folha na tabela desconto_folha_parcelas.
 * @param {object} data - { venda_id, funcionario_id, parcela_n, valor, mes_referencia, ano, status, email_status, email_error }
 * @param {object} user  - usuário que executa a operação
 */
async function saveDescontoFolhaParcela(data = {}, user = {}) {
  const now = new Date().toISOString();
  await run(
    `INSERT INTO desconto_folha_parcelas
      (venda_id, funcionario_id, parcela_n, valor, mes_referencia, ano,
       status, email_status, email_enviado_em, email_error, email_retry_count,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      String(data.venda_id || ""),
      Number(data.funcionario_id || 0),
      Number(data.parcela_n || 1),
      Number(data.valor || 0),
      Number(data.mes_referencia || 1),
      Number(data.ano || new Date().getFullYear()),
      String(data.status || "pendente"),
      String(data.email_status || "nao_enviado"),
      String(data.email_enviado_em || ""),
      String(data.email_error || ""),
      Number(data.email_retry_count || 0),
      now,
      now
    ]
  );
  appendAuditLog({
    audit_id: `AUD_${Date.now()}_DFP`,
    action: "DESCONTO_FOLHA_PARCELA_CRIADA",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: user?.role || "",
    reason: `Parcela ${data.parcela_n} de R$ ${data.valor} para venda ${data.venda_id}`,
    before: null,
    after: data
  });
}

/**
 * Atualiza o status de uma parcela de desconto em folha.
 * @param {number} parcelaId
 * @param {string} newStatus
 * @param {object} user
 */
async function updateDescontoFolhaParcelaStatus(parcelaId, newStatus, user = {}) {
  const now = new Date().toISOString();
  await run(
    `UPDATE desconto_folha_parcelas SET status = ?, updated_at = ? WHERE id = ?`,
    [newStatus, now, parcelaId]
  );
  appendAuditLog({
    audit_id: `AUD_${Date.now()}_DFP_STATUS`,
    action: "DESCONTO_FOLHA_PARCELA_STATUS_ATUALIZADO",
    created_at: now,
    actor: user?.name || user?.email || "sistema",
    actor_role: user?.role || "",
    reason: `Parcela ${parcelaId} -> ${newStatus}`,
    before: { parcelaId },
    after: { parcelaId, newStatus }
  });
}

/**
 * Lista parcelas de desconto em folha por venda_id.
 * @param {string} vendaId
 * @returns {Promise<Array>}
 */
async function listDescontoFolhaParcelasByVenda(vendaId) {
  return all(
    `SELECT * FROM desconto_folha_parcelas WHERE venda_id = ? ORDER BY parcela_n ASC`,
    [vendaId]
  );
}

/**
 * Calcula a data de vencimento de cada parcela a partir de "hoje".
 * Primeira parcela = mês/ano atual; parcelas seguintes = meses subsequentes.
 * @param {number} numParcelas
 * @returns {Array<{mes_referencia: number, ano: number}>}
 */
function calcularParcelasReferences(numParcelas = 1) {
  const now = new Date();
  const refs = [];
  for (let i = 0; i < numParcelas; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    refs.push({
      mes_referencia: d.getMonth() + 1,
      ano: d.getFullYear()
    });
  }
  return refs;
}

/**
 * Valida todos os requisitos de desconto em folha para uma venda.
 * Lança Error com mensagem clara em caso de violação.
 *
 * @param {object} session          - sessão da venda
 * @param {object} payment          - { method: "desconto_folha", amount, installments, funcionario_id }
 * @param {object} config           - getDescontoFolhaConfig()
 * @param {object} funcionario      - getFuncionarioById(funcionario_id)
 * @param {boolean} carenciaOk      - true se o funcionário tem exceção ativa de carência
 */
function validateDescontoFolha(session = {}, payment = {}, config = {}, funcionario = {}, carenciaOk = false) {
  const funcId = payment.funcionario_id || session.funcionario_id;
  if (!funcId) {
    throw new Error("ID do funcionário não informado para desconto em folha.");
  }

  // 1. Funcionário existe e está ativo
  if (!funcionario?.id) {
    throw new Error("Funcionário não encontrado.");
  }
  if (String(funcionario.status || "").toLowerCase() !== "ativo") {
    throw new Error("Funcionário inativo. Desconto em folha não disponível.");
  }

  // 2. Valor > 0
  const amount = Number(payment.amount || 0);
  if (amount <= 0) {
    throw new Error("Valor do desconto em folha precisa ser maior que zero.");
  }

  // 3. Número de parcelas
  const installments = Math.max(1, Math.min(10, Math.round(Number(payment.installments || 1))));
  const maxParcelas = Math.max(1, Math.round(Number(config.max_parcelas || 3)));
  if (installments > maxParcelas) {
    throw new Error(`Máximo de ${maxParcelas} parcela${maxParcelas > 1 ? "s" : ""} excedido. Solicitado: ${installments}.`);
  }

  // 4. Limite por parcela
  const installmentAmount = amount / installments;
  const limiteParcela = parseFloat(config.limite_parcela || "500.00");
  if (installmentAmount > limiteParcela + 0.001) {
    throw new Error(
      `Parcela de R$ ${installmentAmount.toFixed(2)} excede limite de R$ ${limiteParcela.toFixed(2)} por parcela. ` +
      `MaxParcelas=${maxParcelas}. Ajuste o número de parcelas.`
    );
  }

  // 5. Carência (pulada se carenciaOk=true, i.e., Fabi/Milene)
  const carenciaDias = Math.max(0, Math.round(Number(config.carencia_dias || 90)));
  if (!carenciaOk && carenciaDias > 0 && funcionario.data_admissao) {
    const admissao = new Date(funcionario.data_admissao);
    if (!isNaN(admissao.getTime())) {
      const hoje = new Date();
      const diasDesdeAdmissao = Math.floor((hoje - admissao) / (1000 * 60 * 60 * 24));
      if (diasDesdeAdmissao < carenciaDias) {
        throw new Error(
          `Carência de ${carenciaDias} dias não cumprida. ` +
          `Funcionário admitido em ${funcionario.data_admissao} (${diasDesdeAdmissao} dias). ` +
          `Se for Fabi ou Milene, acione o gestor.`
        );
      }
    }
  }
}

module.exports = {
  listFuncionarios,
  getFuncionarioById,
  createFuncionario,
  updateFuncionario,
  listFuncionarioExcecoes,
  createFuncionarioExcecao,
  isFuncionarioExcecao,
  getDescontoFolhaConfig,
  updateDescontoFolhaConfig,
  saveChequePagamento,
  saveDescontoFolhaParcela,
  updateDescontoFolhaParcelaStatus,
  listDescontoFolhaParcelasByVenda,
  calcularParcelasReferences,
  validateDescontoFolha
};