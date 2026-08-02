"use strict";

/**
 * DTO for Order Lifecycle
 * Formatting, validation, and envelope utilities.
 */

const { STATES } = require("./OrderLifecycleMachine");

function formatStatusForDisplay(status) {
  const labels = {
    [STATES.CREATED]: "Criado",
    [STATES.AWAITING_PAYMENT]: "Aguardando pagamento",
    [STATES.PAYMENT_PROCESSING]: "Processando pagamento",
    [STATES.PAID]: "Pago",
    [STATES.RESERVED]: "Reserva confirmada",
    [STATES.PICKING]: "Separando",
    [STATES.PACKED]: "Embalado",
    [STATES.READY_FOR_PICKUP]: "Pronto para retirada",
    [STATES.READY_TO_SHIP]: "Pronto para envio",
    [STATES.SHIPPED]: "Enviado",
    [STATES.DELIVERED]: "Entregue",
    [STATES.CANCELLED]: "Cancelado",
    [STATES.RETURN_REQUESTED]: "Devolução solicitada",
    [STATES.RETURN_APPROVED]: "Devolução aprovada",
    [STATES.RETURN_REJECTED]: "Devolução rejeitada",
    [STATES.RETURN_RECEIVED]: "Devolução recebida",
    [STATES.REFUNDED]: "Reembolsado",
    [STATES.PARTIALLY_REFUNDED]: "Reembolso parcial",
  };
  return labels[status] || status;
}

function formatStatusColor(status) {
  const colors = {
    [STATES.CREATED]: "info",
    [STATES.AWAITING_PAYMENT]: "warning",
    [STATES.PAYMENT_PROCESSING]: "info",
    [STATES.PAID]: "success",
    [STATES.RESERVED]: "success",
    [STATES.PICKING]: "info",
    [STATES.PACKED]: "success",
    [STATES.READY_FOR_PICKUP]: "success",
    [STATES.READY_TO_SHIP]: "info",
    [STATES.SHIPPED]: "info",
    [STATES.DELIVERED]: "success",
    [STATES.CANCELLED]: "error",
    [STATES.RETURN_REQUESTED]: "warning",
    [STATES.RETURN_APPROVED]: "info",
    [STATES.RETURN_REJECTED]: "error",
    [STATES.RETURN_RECEIVED]: "info",
    [STATES.REFUNDED]: "success",
    [STATES.PARTIALLY_REFUNDED]: "warning",
  };
  return colors[status] || "info";
}

function formatCentsBrl(cents) {
  if (typeof cents !== "number" || cents <= 0) return "R$ 0,00";
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function orderDto(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber || `AERO-${order.id.slice(0, 8).toUpperCase()}`,
    status: order.status,
    statusLabel: formatStatusForDisplay(order.status),
    statusColor: formatStatusColor(order.status),
    totalAmount: formatCentsBrl(order.totalAmountCents),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items || [],
    fulfillment: order.fulfillment || {},
  };
}

function timelineEntryDto(entry) {
  return {
    id: entry.id,
    status: entry.status,
    statusLabel: formatStatusForDisplay(entry.status),
    event: entry.event,
    description: entry.description,
    type: entry.type,
    icon: entry.icon,
    visibleToCustomer: !!entry.visibleToCustomer,
    at: entry.at,
  };
}

function envelope(data, meta = {}) {
  return {
    data,
    meta: {
      timestamp: new Date().toISOString(),
      ...meta,
    },
  };
}

class LifecycleError extends Error {
  constructor(code, httpStatus = 400, details = {}) {
    super(code);
    this.name = "LifecycleError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

module.exports = {
  formatStatusForDisplay,
  formatStatusColor,
  formatCentsBrl,
  orderDto,
  timelineEntryDto,
  envelope,
  LifecycleError,
};
