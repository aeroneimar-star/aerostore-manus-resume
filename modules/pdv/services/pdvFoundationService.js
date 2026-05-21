"use strict";

const {
  PDV_BASE_ROUTES,
  PDV_ROUTE_META,
  PDV_PAYMENT_METHODS,
  PDV_IMPORT_PIPELINE,
  PDV_SECURITY_FOUNDATION,
  PDV_BUSINESS_GUARDRAILS
} = require("../utils/pdvConfig");
const { PDV_IMPORT_TYPES } = require("../utils/pdvImportConfig");
const { PDV_CONSOLIDATION_EVENT_TYPES } = require("../consolidation/utils/pdvConsolidationConfig");

function getPdvFoundationManifest() {
  return {
    module: "PDV AEROSTORE",
    status: "seed_operational_ready",
    version: "stage_7_5",
    isolated: true,
    title: "PDV AEROSTORE",
    subtitle: "Fundação operacional do PDV para loja física, preparada para crescimento sem misturar com o CRM atual.",
    description: "Estrutura base isolada para caixa, trocas, clientes, produtos e importações do PDV AEROSTORE.",
    routes: PDV_ROUTE_META,
    routePaths: PDV_BASE_ROUTES,
    frontendPrinciples: [
      "loading_visual_em_toda_operacao_assincrona",
      "feedback_visual_de_sucesso_erro",
      "poucos_cliques",
      "busca_rapida",
      "botoes_grandes",
      "layout_touch_friendly",
      "visual_moderno_minimalista_premium"
    ],
    paymentMethods: PDV_PAYMENT_METHODS,
    importPipeline: PDV_IMPORT_PIPELINE,
    importTypes: PDV_IMPORT_TYPES,
    consolidationEventTypes: PDV_CONSOLIDATION_EVENT_TYPES,
    securityFoundation: PDV_SECURITY_FOUNDATION,
    businessGuardrails: PDV_BUSINESS_GUARDRAILS,
    roadmap: [
      "caixa_operacional",
      "trocas_credito",
      "identificacao_de_cliente",
      "consulta_rapida_de_produtos",
      "logs_historicos",
      "consolidacao_de_clientes",
      "timeline_de_relacionamento",
      "carrinho_operacional",
      "orcamentos_e_reservas",
      "motor_de_eventos",
      "venda_operacional_real",
      "cashback_oficial_12_porcento",
      "pagamentos_compostos",
      "vale_presente_e_trocas",
      "permissoes_por_funcao",
      "caixa_operacional_real",
      "pin_temporario",
      "auditoria_absoluta",
      "fechamento_e_reabertura_de_caixa",
      "cupom_digital_pdf_ready",
      "qr_code_de_venda",
      "fila_de_mensagens",
      "venda_presente_completa",
      "welcome_bonus_preparado",
      "estoque_operacional_por_loja",
      "movimentacoes_auditaveis",
      "baixa_automatica_por_venda",
      "alertas_e_transferencias",
      "dashboard_gerencial_do_dono",
      "relatorios_por_vendedor_loja_cliente",
      "insights_comerciais_automaticos",
      "exportacao_basica_csv_json",
      "massa_de_teste_operacional_isolada",
      "limpeza_segura_de_seed_data"
    ],
    databaseBlueprint: {
      mode: "blueprint_only",
      notes: [
        "nenhum_schema_ativo_do_crm_foi_alterado_nesta_fase",
        "movimentacoes_criticas_devem_gerar_historico",
        "registros_importantes_nao_devem_ser_apagados"
      ]
    }
  };
}

module.exports = {
  getPdvFoundationManifest
};
