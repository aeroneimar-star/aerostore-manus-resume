"use strict";

/**
 * Return Service
 * Handles return request structure.
 * Full operational flow NOT implemented — only structure.
 * Allows: solicitar devolução, registrar motivo, status, timeline.
 */

const RETURN_STATUSES = Object.freeze({
  REQUESTED: "REQUESTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  ITEM_RECEIVED: "ITEM_RECEIVED",
  REFUND_PENDING: "REFUND_PENDING",
  REFUND_COMPLETED: "REFUND_COMPLETED",
});

const RETURN_REASONS = Object.freeze({
  DEFECTIVE: "DEFECTIVE",
  WRONG_ITEM: "WRONG_ITEM",
  DID_NOT_LIKE: "DID_NOT_LIKE",
  WRONG_SIZE: "WRONG_SIZE",
  OTHER: "OTHER",
});

class ReturnService {
  constructor(options = {}) {
    this._db = options.dbApi;
    this._eventBus = options.eventBus;
    this._timelineService = options.timelineService;
    this._returns = new Map(); // returnId → return data
    this._orderReturns = new Map(); // orderId → [returnIds]
  }

  /**
   * Request a return for a delivered order.
   */
  async requestReturn(orderId, { items, reason, description }) {
    if (!orderId || !items || !reason) {
      throw new Error("RETURN_REQUEST_MISSING_FIELDS");
    }

    if (!Object.values(RETURN_REASONS).includes(reason)) {
      throw new Error(`INVALID_RETURN_REASON: ${reason}`);
    }

    const returnId = `RET-${Date.now().toString(36).toUpperCase()}`;
    const returnData = {
      id: returnId,
      orderId,
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity || 1,
      })),
      reason,
      description: description || "",
      status: RETURN_STATUSES.REQUESTED,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      approvedAt: null,
      receivedAt: null,
      refundedAt: null,
    };

    this._returns.set(returnId, returnData);

    if (!this._orderReturns.has(orderId)) {
      this._orderReturns.set(orderId, []);
    }
    this._orderReturns.get(orderId).push(returnId);

    // Emit event
    if (this._eventBus) {
      await this._eventBus.emit("RETURN_REQUESTED", {
        returnId,
        orderId,
        items,
        reason,
      });
    }

    // Record timeline
    if (this._timelineService) {
      await this._timelineService.record({
        orderId,
        status: "RETURN_REQUESTED",
        event: "RETURN_REQUESTED",
        description: `Devolução solicitada: ${reason}`,
        type: "CUSTOMER",
        visibleToCustomer: true,
        visibleInternally: true,
        icon: "return",
        metadata: { returnId, reason },
      });
    }

    return returnData;
  }

  /**
   * Approve a return request.
   */
  async approveReturn(returnId) {
    const ret = this._returns.get(returnId);
    if (!ret) throw new Error(`RETURN_NOT_FOUND: ${returnId}`);
    if (ret.status !== RETURN_STATUSES.REQUESTED && ret.status !== RETURN_STATUSES.UNDER_REVIEW) {
      throw new Error(`RETURN_NOT_IN_REVIEW_STATE: ${ret.status}`);
    }

    ret.status = RETURN_STATUSES.APPROVED;
    ret.approvedAt = new Date().toISOString();
    ret.updatedAt = new Date().toISOString();

    if (this._eventBus) {
      await this._eventBus.emit("RETURN_APPROVED", {
        returnId,
        orderId: ret.orderId,
      });
    }

    if (this._timelineService) {
      await this._timelineService.record({
        orderId: ret.orderId,
        status: "RETURN_APPROVED",
        event: "RETURN_APPROVED",
        description: "Devolução aprovada",
        type: "INTERNAL",
        visibleToCustomer: true,
        visibleInternally: true,
        icon: "return",
        metadata: { returnId },
      });
    }

    return ret;
  }

  /**
   * Reject a return request.
   */
  async rejectReturn(returnId, reason) {
    const ret = this._returns.get(returnId);
    if (!ret) throw new Error(`RETURN_NOT_FOUND: ${returnId}`);
    if (ret.status !== RETURN_STATUSES.REQUESTED && ret.status !== RETURN_STATUSES.UNDER_REVIEW) {
      throw new Error(`RETURN_NOT_IN_REVIEW_STATE: ${ret.status}`);
    }

    ret.status = RETURN_STATUSES.REJECTED;
    ret.updatedAt = new Date().toISOString();

    if (this._eventBus) {
      await this._eventBus.emit("RETURN_REJECTED", {
        returnId,
        orderId: ret.orderId,
        reason,
      });
    }

    if (this._timelineService) {
      await this._timelineService.record({
        orderId: ret.orderId,
        status: "RETURN_REJECTED",
        event: "RETURN_REJECTED",
        description: `Devolução rejeitada: ${reason || "Motivo não informado"}`,
        type: "INTERNAL",
        visibleToCustomer: true,
        visibleInternally: true,
        icon: "return",
        metadata: { returnId, reason },
      });
    }

    return ret;
  }

  /**
   * Mark return item as received.
   */
  async markReceived(returnId) {
    const ret = this._returns.get(returnId);
    if (!ret) throw new Error(`RETURN_NOT_FOUND: ${returnId}`);
    if (ret.status !== RETURN_STATUSES.APPROVED) {
      throw new Error(`RETURN_NOT_APPROVED: ${ret.status}`);
    }

    ret.status = RETURN_STATUSES.ITEM_RECEIVED;
    ret.receivedAt = new Date().toISOString();
    ret.updatedAt = new Date().toISOString();

    if (this._eventBus) {
      await this._eventBus.emit("RETURN_RECEIVED", {
        returnId,
        orderId: ret.orderId,
      });
    }

    if (this._timelineService) {
      await this._timelineService.record({
        orderId: ret.orderId,
        status: "RETURN_RECEIVED",
        event: "RETURN_RECEIVED",
        description: "Devolução recebida",
        type: "INTERNAL",
        visibleToCustomer: true,
        visibleInternally: true,
        icon: "return",
        metadata: { returnId },
      });
    }

    return ret;
  }

  /**
   * Get return details.
   */
  getReturn(returnId) {
    return this._returns.get(returnId) || null;
  }

  /**
   * Get all returns for an order.
   */
  getReturnsByOrder(orderId) {
    const returnIds = this._orderReturns.get(orderId) || [];
    return returnIds.map((id) => this._returns.get(id)).filter(Boolean);
  }

  /**
   * Clear all data (for testing).
   */
  clear() {
    this._returns.clear();
    this._orderReturns.clear();
  }
}

function createReturnService(options) {
  return new ReturnService(options);
}

module.exports = {
  ReturnService,
  createReturnService,
  RETURN_STATUSES,
  RETURN_REASONS,
};
