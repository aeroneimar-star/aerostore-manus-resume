"use strict";

/**
 * Order Lifecycle Engine
 * Central orchestrator for order lifecycle.
 * Consumes events from EventBus and coordinates:
 * - State machine transitions
 * - Timeline recording
 * - Inventory reservation
 * - Notifications
 * - Audit
 *
 * Designed for multi-channel consumption (APP, CRM, PDV, WhatsApp, Marketplace).
 */

const { OrderLifecycleMachine, STATES, EVENTS } = require("./OrderLifecycleMachine");
const { getEventBus } = require("./EventBus");

class OrderLifecycleEngine {
  constructor(options = {}) {
    this._db = options.dbApi;
    this._eventBus = options.eventBus || getEventBus();
    this._timelineService = options.timelineService;
    this._inventoryService = options.inventoryService;
    this._notificationService = options.notificationService;
    this._auditService = options.auditService;

    this._machines = new Map(); // orderId → machine
    this._locks = new Map();    // orderId → Promise (concurrency)
  }

  /**
   * Initialize lifecycle for an order.
   */
  async initOrder(orderId, initialData = {}) {
    const machine = new OrderLifecycleMachine(STATES.CREATED);
    this._machines.set(orderId, machine);

    const result = machine.transition(EVENTS.ORDER_CREATED, { orderId, ...initialData });
    if (!result.success) {
      throw new Error(`ORDER_INIT_FAILED: ${result.error}`);
    }

    // Emit to bus for consumers
    await this._eventBus.emit(EVENTS.ORDER_CREATED, {
      orderId,
      toState: STATES.AWAITING_PAYMENT,
      ...initialData,
    });

    return { orderId, state: machine.state, history: machine.history };
  }

  /**
   * Process a lifecycle event with concurrency lock.
   */
  async processEvent(orderId, event, metadata = {}) {
    const lock = await this._acquireLock(orderId);
    try {
      const machine = this._machines.get(orderId);
      if (!machine) {
        throw new Error(`ORDER_NOT_FOUND: ${orderId}`);
      }

      const fromState = machine.state;
      const result = machine.transition(event, { orderId, ...metadata });

      if (!result.success) {
        return {
          success: false,
          error: result.error,
          message: result.message,
          orderId,
          fromState,
          event,
        };
      }

      // Record timeline entry
      if (this._timelineService) {
        await this._timelineService.record({
          orderId,
          status: result.to,
          event,
          from: result.from,
          description: this._describeEvent(event, metadata),
          type: this._classifyEvent(event),
          visibleToCustomer: this._isCustomerVisible(event),
          visibleInternally: this._isInternalOnly(event),
          icon: this._iconForEvent(event),
          metadata,
          at: new Date().toISOString(),
        });
      }

      // Emit event to bus
      await this._eventBus.emit(event, {
        orderId,
        from: result.from,
        to: result.to,
        ...metadata,
      });

      return {
        success: true,
        orderId,
        from: result.from,
        to: result.to,
        event,
      };
    } finally {
      this._releaseLock(orderId, lock);
    }
  }

  /**
   * Get current state for an order.
   */
  getState(orderId) {
    const machine = this._machines.get(orderId);
    if (!machine) return null;
    return { orderId, state: machine.state, history: machine.history };
  }

  /**
   * Get all valid next events for an order.
   */
  availableEvents(orderId) {
    const machine = this._machines.get(orderId);
    if (!machine) return [];
    return machine.availableEvents();
  }

  /**
   * Check if order is in terminal state.
   */
  isTerminal(orderId) {
    const machine = this._machines.get(orderId);
    if (!machine) return true;
    return machine.isTerminal();
  }

  // --- Private ---

  async _acquireLock(orderId) {
    let lock = this._locks.get(orderId);
    const current = lock || Promise.resolve();
    let release;
    const next = new Promise((resolve) => { release = resolve; });
    this._locks.set(orderId, next);
    await current;
    return release;
  }

  _releaseLock(orderId, release) {
    release();
    if (this._locks.get(orderId) && this._locks.get(orderId) === release) {
      this._locks.delete(orderId);
    }
  }

  _describeEvent(event, metadata) {
    const descriptions = {
      [EVENTS.ORDER_CREATED]: "Pedido criado",
      [EVENTS.PAYMENT_CONFIRMED]: "Pagamento confirmado",
      [EVENTS.PAYMENT_FAILED]: "Pagamento falhou",
      [EVENTS.RESERVATION_CONSUMED]: "Reserva de estoque consumida",
      [EVENTS.PICKING_STARTED]: "Separação iniciada",
      [EVENTS.PICKING_COMPLETED]: "Separação concluída",
      [EVENTS.PACKED]: "Pedido embalado",
      [EVENTS.READY_FOR_PICKUP]: "Pronto para retirada",
      [EVENTS.READY_TO_SHIP]: "Pronto para envio",
      [EVENTS.SHIPPED]: "Pedido enviado",
      [EVENTS.DELIVERED]: "Pedido entregue",
      [EVENTS.RETURN_REQUESTED]: "Devolução solicitada",
      [EVENTS.RETURN_APPROVED]: "Devolução aprovada",
      [EVENTS.RETURN_REJECTED]: "Devolução rejeitada",
      [EVENTS.RETURN_RECEIVED]: "Devolução recebida",
      [EVENTS.REFUND_COMPLETED]: "Reembolso concluído",
      [EVENTS.ORDER_CANCELLED]: "Pedido cancelado",
    };
    return descriptions[event] || event;
  }

  _classifyEvent(event) {
    const customerEvents = new Set([
      EVENTS.ORDER_CREATED, EVENTS.PAYMENT_CONFIRMED, EVENTS.PAYMENT_FAILED,
      EVENTS.READY_FOR_PICKUP, EVENTS.SHIPPED, EVENTS.DELIVERED,
      EVENTS.RETURN_REQUESTED, EVENTS.RETURN_APPROVED, EVENTS.RETURN_REJECTED,
      EVENTS.REFUND_COMPLETED, EVENTS.ORDER_CANCELLED,
    ]);
    return customerEvents.has(event) ? "CUSTOMER" : "INTERNAL";
  }

  _isCustomerVisible(event) {
    return this._classifyEvent(event) === "CUSTOMER";
  }

  _isInternalOnly(event) {
    return this._classifyEvent(event) === "INTERNAL";
  }

  _iconForEvent(event) {
    const icons = {
      [EVENTS.ORDER_CREATED]: "order",
      [EVENTS.PAYMENT_CONFIRMED]: "payment",
      [EVENTS.PAYMENT_FAILED]: "error",
      [EVENTS.RESERVATION_CONSUMED]: "inventory",
      [EVENTS.PICKING_STARTED]: "picking",
      [EVENTS.PICKING_COMPLETED]: "picking",
      [EVENTS.PACKED]: "package",
      [EVENTS.READY_FOR_PICKUP]: "store",
      [EVENTS.READY_TO_SHIP]: "truck",
      [EVENTS.SHIPPED]: "truck",
      [EVENTS.DELIVERED]: "check",
      [EVENTS.RETURN_REQUESTED]: "return",
      [EVENTS.RETURN_APPROVED]: "return",
      [EVENTS.RETURN_REJECTED]: "return",
      [EVENTS.RETURN_RECEIVED]: "return",
      [EVENTS.REFUND_COMPLETED]: "refund",
      [EVENTS.ORDER_CANCELLED]: "cancel",
    };
    return icons[event] || "info";
  }
}

function createOrderLifecycleEngine(options) {
  return new OrderLifecycleEngine(options);
}

module.exports = {
  OrderLifecycleEngine,
  createOrderLifecycleEngine,
  STATES,
  EVENTS,
};
