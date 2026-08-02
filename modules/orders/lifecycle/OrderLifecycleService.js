"use strict";

/**
 * Order Lifecycle Service
 * Facade that wires together:
 * - OrderLifecycleEngine (state machine + transitions)
 * - TimelineService (history recording)
 * - ReturnService (returns structure)
 * - NotificationEventEmitter (notification preparation)
 * - TrackingProvider (shipping tracking contract)
 * - EventBus (internal event routing)
 *
 * Single entry point for order lifecycle operations.
 * Multi-channel: APP, CRM, PDV, WhatsApp, Marketplace.
 */

const { OrderLifecycleEngine, STATES, EVENTS } = require("./OrderLifecycleEngine");
const { TimelineService } = require("./TimelineService");
const { ReturnService, RETURN_STATUSES } = require("./ReturnService");
const { createNotificationEventEmitter } = require("./NotificationEvents");
const { EventBus, getEventBus, resetEventBus } = require("./EventBus");
const { MockTrackingProvider } = require("./TrackingProvider");
const {
  formatStatusForDisplay,
  formatStatusColor,
  orderDto,
  timelineEntryDto,
  envelope,
  LifecycleError,
} = require("./orderLifecycleDto");

function createOrderLifecycleService(options = {}) {
  const eventBus = options.eventBus || new EventBus();
  const timelineService = options.timelineService || new TimelineService({ dbApi: options.dbApi });
  const returnService = options.returnService || new ReturnService({
    dbApi: options.dbApi,
    eventBus,
    timelineService,
  });

  const engine = new OrderLifecycleEngine({
    dbApi: options.dbApi,
    eventBus,
    timelineService,
    inventoryService: options.inventoryService,
    notificationService: options.notificationService,
    auditService: options.auditService,
  });

  const notificationEmitter = options.notificationEmitter ||
    createNotificationEventEmitter({ eventBus, enabled: true });

  const trackingProvider = options.trackingProvider || new MockTrackingProvider();

  // Attach notification subscriptions
  notificationEmitter.attach();

  return {
    engine,
    eventBus,
    timelineService,
    returnService,
    notificationEmitter,
    trackingProvider,

    // --- Public API ---

    /**
     * Create a new order and initialize lifecycle.
     */
    async createOrder(input) {
      const orderId = input.orderId;
      if (!orderId) throw new LifecycleError("ORDER_ID_REQUIRED");

      const result = await engine.initOrder(orderId, {
        orderNumber: input.orderNumber,
        totalAmountCents: input.totalAmountCents,
        customerId: input.customerId,
        items: input.items,
        fulfillmentType: input.fulfillmentType || "DELIVERY",
      });

      return orderDto({
        id: orderId,
        status: result.state,
        totalAmountCents: input.totalAmountCents,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: input.items || [],
        fulfillment: {
          type: input.fulfillmentType || "DELIVERY",
          storeId: input.storeId,
          address: input.address,
        },
      });
    },

    /**
     * Confirm payment for an order.
     */
    async confirmPayment(orderId, metadata = {}) {
      const result = await engine.processEvent(orderId, EVENTS.PAYMENT_CONFIRMED, metadata);
      if (!result.success) {
        throw new LifecycleError(result.error, 409, result);
      }
      return result;
    },

    /**
     * Mark order as paid.
     */
    async markPaid(orderId, metadata = {}) {
      return engine.processEvent(orderId, EVENTS.PAYMENT_CONFIRMED, metadata);
    },

    /**
     * Start picking.
     */
    async startPicking(orderId, metadata = {}) {
      return engine.processEvent(orderId, EVENTS.PICKING_STARTED, metadata);
    },

    /**
     * Complete picking.
     */
    async completePicking(orderId, metadata = {}) {
      return engine.processEvent(orderId, EVENTS.PICKING_COMPLETED, metadata);
    },

    /**
     * Mark as packed.
     */
    async markPacked(orderId, metadata = {}) {
      return engine.processEvent(orderId, EVENTS.PACKED, metadata);
    },

    /**
     * Mark as ready for pickup.
     */
    async markReadyForPickup(orderId, metadata = {}) {
      return engine.processEvent(orderId, EVENTS.READY_FOR_PICKUP, metadata);
    },

    /**
     * Mark as ready to ship.
     */
    async markReadyToShip(orderId, metadata = {}) {
      return engine.processEvent(orderId, EVENTS.READY_TO_SHIP, metadata);
    },

    /**
     * Mark as shipped.
     */
    async markShipped(orderId, metadata = {}) {
      return engine.processEvent(orderId, EVENTS.SHIPPED, metadata);
    },

    /**
     * Mark as delivered.
     */
    async markDelivered(orderId, metadata = {}) {
      return engine.processEvent(orderId, EVENTS.DELIVERED, metadata);
    },

    /**
     * Cancel an order.
     */
    async cancelOrder(orderId, reason = "") {
      return engine.processEvent(orderId, EVENTS.ORDER_CANCELLED, { reason });
    },

    /**
     * Get order state.
     */
    getOrderState(orderId) {
      const state = engine.getState(orderId);
      if (!state) return null;
      return {
        ...state,
        statusLabel: formatStatusForDisplay(state.state),
        statusColor: formatStatusColor(state.state),
        fulfillmentStep: timelineService.getFulfillmentStep(orderId),
      };
    },

    /**
     * Get customer-visible timeline.
     */
    getCustomerTimeline(orderId) {
      const entries = timelineService.getCustomerVisible(orderId);
      return entries.map(timelineEntryDto);
    },

    /**
     * Get full internal timeline.
     */
    getFullTimeline(orderId) {
      const entries = timelineService.getFull(orderId);
      return entries.map(timelineEntryDto);
    },

    /**
     * Get fulfillment step info.
     */
    getFulfillmentStep(orderId) {
      return timelineService.getFulfillmentStep(orderId);
    },

    /**
     * Request a return.
     */
    async requestReturn(orderId, params) {
      return returnService.requestReturn(orderId, params);
    },

    /**
     * Approve a return.
     */
    async approveReturn(returnId) {
      return returnService.approveReturn(returnId);
    },

    /**
     * Reject a return.
     */
    async rejectReturn(returnId, reason) {
      return returnService.rejectReturn(returnId, reason);
    },

    /**
     * Mark return as received.
     */
    async markReturnReceived(returnId) {
      return returnService.markReceived(returnId);
    },

    /**
     * Get return details.
     */
    getReturn(returnId) {
      return returnService.getReturn(returnId);
    },

    /**
     * Get returns for an order.
     */
    getOrderReturns(orderId) {
      return returnService.getReturnsByOrder(orderId);
    },

    /**
     * Get tracking info.
     */
    async getTracking(trackingCode) {
      return trackingProvider.getTracking(trackingCode);
    },

    /**
     * Create a tracking label.
     */
    async createTrackingLabel(shipment) {
      return trackingProvider.createLabel(shipment);
    },

    /**
     * Get pickup info for a ready order.
     */
    getPickupInfo(orderId, storeData) {
      const state = engine.getState(orderId);
      if (!state || state.state !== STATES.READY_FOR_PICKUP) {
        throw new LifecycleError("ORDER_NOT_READY_FOR_PICKUP", 400);
      }
      return {
        orderId,
        storeName: storeData?.name || "Loja AEROSTORE",
        address: storeData?.address || "Av. Paulista, 1000 - São Paulo, SP",
        hours: storeData?.hours || "Seg-Sáb: 10h-20h, Dom: 12h-18h",
        requiredDocument: "Documento de identidade com foto",
        orderNumber: storeData?.orderNumber || `AERO-${orderId.slice(0, 8).toUpperCase()}`,
      };
    },
  };
}

module.exports = {
  createOrderLifecycleService,
  STATES,
  EVENTS,
  LifecycleError,
};
