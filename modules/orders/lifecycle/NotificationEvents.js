"use strict";

/**
 * Notification Events
 * Prepares notification events for order lifecycle.
 * Does NOT send actual push notifications — just structures the events.
 *
 * Prepared events:
 * - ORDER_PAID
 * - ORDER_READY
 * - ORDER_SHIPPED
 * - ORDER_DELIVERED
 * - RETURN_UPDATED
 */

const NOTIFICATION_TYPES = Object.freeze({
  ORDER_PAID: "ORDER_PAID",
  ORDER_READY: "ORDER_READY",
  ORDER_SHIPPED: "ORDER_SHIPPED",
  ORDER_DELIVERED: "ORDER_DELIVERED",
  RETURN_UPDATED: "RETURN_UPDATED",
});

/**
 * Map lifecycle events to notification types.
 */
const EVENT_TO_NOTIFICATION = Object.freeze({
  PAYMENT_CONFIRMED: NOTIFICATION_TYPES.ORDER_PAID,
  READY_FOR_PICKUP: NOTIFICATION_TYPES.ORDER_READY,
  SHIPPED: NOTIFICATION_TYPES.ORDER_SHIPPED,
  DELIVERED: NOTIFICATION_TYPES.ORDER_DELIVERED,
  RETURN_REQUESTED: NOTIFICATION_TYPES.RETURN_UPDATED,
  RETURN_APPROVED: NOTIFICATION_TYPES.RETURN_UPDATED,
  RETURN_REJECTED: NOTIFICATION_TYPES.RETURN_UPDATED,
  RETURN_RECEIVED: NOTIFICATION_TYPES.RETURN_UPDATED,
  REFUND_COMPLETED: NOTIFICATION_TYPES.RETURN_UPDATED,
});

const NOTIFICATION_TEMPLATES = Object.freeze({
  [NOTIFICATION_TYPES.ORDER_PAID]: {
    title: "Pagamento confirmado",
    body: (data) => `Seu pedido #${data.orderNumber || data.orderId} foi pago com sucesso.`,
    icon: "payment",
    channel: "push",
  },
  [NOTIFICATION_TYPES.ORDER_READY]: {
    title: "Pedido pronto",
    body: (data) => `Seu pedido #${data.orderNumber || data.orderId} está pronto para retirada.`,
    icon: "store",
    channel: "push",
  },
  [NOTIFICATION_TYPES.ORDER_SHIPPED]: {
    title: "Pedido enviado",
    body: (data) => `Seu pedido #${data.orderNumber || data.orderId} foi enviado. ${data.trackingCode ? `Código: ${data.trackingCode}` : ""}`,
    icon: "truck",
    channel: "push",
  },
  [NOTIFICATION_TYPES.ORDER_DELIVERED]: {
    title: "Pedido entregue",
    body: (data) => `Seu pedido #${data.orderNumber || data.orderId} foi entregue.`,
    icon: "check",
    channel: "push",
  },
  [NOTIFICATION_TYPES.RETURN_UPDATED]: {
    title: "Atualização de devolução",
    body: (data) => `Status da devolução do pedido #${data.orderNumber || data.orderId} foi atualizado.`,
    icon: "return",
    channel: "push",
  },
});

class NotificationEventEmitter {
  constructor(options = {}) {
    this._eventBus = options.eventBus;
    this._sentNotifications = [];
    this._enabled = options.enabled !== false;
  }

  /**
   * Subscribe to lifecycle events and emit notifications.
   */
  attach() {
    if (!this._eventBus) return;

    for (const [lifecycleEvent, notificationType] of Object.entries(EVENT_TO_NOTIFICATION)) {
      this._eventBus.on(lifecycleEvent, (envelope) => {
        if (!this._enabled) return null;
        return this._emitNotification(notificationType, envelope.payload);
      });
    }
  }

  /**
   * Manually emit a notification.
   */
  async _emitNotification(type, payload) {
    const template = NOTIFICATION_TEMPLATES[type];
    if (!template) return null;

    const notification = {
      type,
      title: template.title,
      body: template.body(payload),
      icon: template.icon,
      channel: template.channel,
      orderId: payload.orderId,
      at: new Date().toISOString(),
      delivered: false, // Not actually sent
    };

    this._sentNotifications.push(notification);

    // Emit to bus for consumers
    if (this._eventBus) {
      await this._eventBus.emit(`NOTIFICATION_${type}`, notification);
    }

    return notification;
  }

  /**
   * Get all sent notifications (for testing).
   */
  getSentNotifications() {
    return [...this._sentNotifications];
  }

  /**
   * Get notifications for a specific order.
   */
  getNotificationsForOrder(orderId) {
    return this._sentNotifications.filter((n) => n.orderId === orderId);
  }

  /**
   * Clear notifications (for testing).
   */
  clear() {
    this._sentNotifications = [];
  }
}

function createNotificationEventEmitter(options) {
  return new NotificationEventEmitter(options);
}

module.exports = {
  NotificationEventEmitter,
  createNotificationEventEmitter,
  NOTIFICATION_TYPES,
  EVENT_TO_NOTIFICATION,
  NOTIFICATION_TEMPLATES,
};
