"use strict";

/**
 * Timeline Service
 * Public timeline for each order.
 * Records history with: status, description, date, icon, type, visibility.
 * Does NOT expose internal administrative events to customers.
 */

class TimelineService {
  constructor(options = {}) {
    this._db = options.dbApi;
    this._entries = new Map(); // orderId → entries[]
  }

  /**
   * Record a timeline entry.
   */
  async record(entry) {
    const {
      orderId,
      status,
      event,
      from,
      description,
      type,
      visibleToCustomer,
      visibleInternally,
      icon,
      metadata = {},
      at,
    } = entry;

    if (!orderId || !status || !event) {
      throw new Error("TIMELINE_RECORD_MISSING_FIELDS");
    }

    const record = {
      id: Math.random().toString(36).slice(2, 14),
      orderId,
      status,
      event,
      from,
      description: description || event,
      type: type || "INTERNAL",
      visibleToCustomer: visibleToCustomer !== undefined ? visibleToCustomer : false,
      visibleInternally: visibleInternally !== undefined ? visibleInternally : true,
      icon: icon || "info",
      metadata: JSON.stringify(metadata),
      at: at || new Date().toISOString(),
    };

    if (this._db) {
      try {
        await this._db.run(
          `INSERT INTO app_order_timeline (id, order_id, status, event, from_status, description, type, visible_to_customer, visible_internally, icon, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [record.id, record.orderId, record.status, record.event, record.from || "",
           record.description, record.type, record.visibleToCustomer ? 1 : 0,
           record.visibleInternally ? 1 : 0, record.icon, record.metadata, record.at]
        );
      } catch (err) {
        // DB write is best-effort; in-memory fallback
      }
    }

    // In-memory storage
    if (!this._entries.has(orderId)) {
      this._entries.set(orderId, []);
    }
    this._entries.get(orderId).push(record);

    return record;
  }

  /**
   * Get full timeline for an order (internal).
   */
  getFull(orderId) {
    return this._entries.get(orderId) || [];
  }

  /**
   * Get customer-visible timeline.
   */
  getCustomerVisible(orderId) {
    const entries = this._entries.get(orderId) || [];
    return entries.filter((e) => e.visibleToCustomer);
  }

  /**
   * Get the latest status.
   */
  getCurrentStatus(orderId) {
    const entries = this._entries.get(orderId) || [];
    if (entries.length === 0) return null;
    const last = entries[entries.length - 1];
    return {
      status: last.status,
      description: last.description,
      icon: last.icon,
      at: last.at,
    };
  }

  /**
   * Get the current step in the fulfillment flow.
   */
  getFulfillmentStep(orderId) {
    const status = this.getCurrentStatus(orderId);
    if (!status) return { step: 0, label: "Criado", nextLabel: "Aguardando pagamento" };

    const steps = [
      { status: "AWAITING_PAYMENT", label: "Aguardando pagamento", nextLabel: "Pagamento confirmado" },
      { status: "PAID", label: "Pagamento confirmado", nextLabel: "Separando pedido" },
      { status: "RESERVED", label: "Reserva confirmada", nextLabel: "Separando pedido" },
      { status: "PICKING", label: "Separando pedido", nextLabel: "Embalando" },
      { status: "PACKED", label: "Embalado", nextLabel: "Pronto para envio" },
      { status: "READY_FOR_PICKUP", label: "Pronto para retirada", nextLabel: "Entregue" },
      { status: "READY_TO_SHIP", label: "Pronto para envio", nextLabel: "Enviado" },
      { status: "SHIPPED", label: "Enviado", nextLabel: "Entregue" },
      { status: "DELIVERED", label: "Entregue", nextLabel: "Concluído" },
      { status: "CANCELLED", label: "Cancelado", nextLabel: null },
      { status: "RETURN_REQUESTED", label: "Devolução solicitada", nextLabel: "Aguardando aprovação" },
      { status: "RETURN_APPROVED", label: "Devolução aprovada", nextLabel: "Aguardando recebimento" },
      { status: "RETURN_REJECTED", label: "Devolução rejeitada", nextLabel: null },
      { status: "RETURN_RECEIVED", label: "Devolução recebida", nextLabel: "Reembolso" },
      { status: "REFUNDED", label: "Reembolso concluído", nextLabel: null },
      { status: "PARTIALLY_REFUNDED", label: "Reembolso parcial", nextLabel: "Reembolso completo" },
    ];

    const current = steps.find((s) => s.status === status.status);
    if (!current) return { step: 0, label: status.status, nextLabel: null };

    const idx = steps.indexOf(current);
    return {
      step: idx + 1,
      total: steps.length,
      label: current.label,
      nextLabel: current.nextLabel,
      status: status.status,
      at: status.at,
    };
  }

  /**
   * Clear in-memory entries (for testing).
   */
  clear() {
    this._entries.clear();
  }
}

function createTimelineService(options) {
  return new TimelineService(options);
}

module.exports = { TimelineService, createTimelineService };
