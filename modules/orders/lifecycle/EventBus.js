"use strict";

/**
 * Internal Event Bus
 * Simple pub/sub for order lifecycle events.
 * Consumers are decoupled — they subscribe to events without knowing the emitter.
 * Flow: Payment Approved → EventBus → OrderLifecycleEngine → [Inventory, Notification, Timeline, Audit]
 */

class EventBus {
  constructor() {
    this._subscribers = new Map();
    this._middleware = [];
  }

  /**
   * Subscribe to an event.
   * Returns unsubscribe function.
   */
  on(event, handler, options = {}) {
    if (typeof handler !== "function") {
      throw new Error("HANDLER_MUST_BE_FUNCTION");
    }

    if (!this._subscribers.has(event)) {
      this._subscribers.set(event, []);
    }

    const subscription = {
      handler,
      priority: options.priority || 0,
      once: options.once || false,
      id: Math.random().toString(36).slice(2, 10),
    };

    this._subscribers.get(event).push(subscription);
    this._subscribers.get(event).sort((a, b) => a.priority - b.priority);

    // Return unsubscribe function
    return () => {
      const handlers = this._subscribers.get(event);
      if (handlers) {
        const idx = handlers.findIndex((s) => s.id === subscription.id);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    };
  }

  /**
   * Subscribe to any event.
   */
  onAll(handler) {
    return this.on("*", handler);
  }

  /**
   * Add middleware that processes all events before dispatch.
   */
  use(middleware) {
    if (typeof middleware !== "function") {
      throw new Error("MIDDLEWARE_MUST_BE_FUNCTION");
    }
    this._middleware.push(middleware);
    return () => {
      const idx = this._middleware.indexOf(middleware);
      if (idx !== -1) this._middleware.splice(idx, 1);
    };
  }

  /**
   * Emit an event to all subscribers.
   * Errors are captured and returned, not thrown.
   */
  async emit(event, payload = {}, context = {}) {
    const envelope = {
      event,
      payload,
      context,
      emittedAt: new Date().toISOString(),
      eventId: Math.random().toString(36).slice(2, 10),
    };

    // Run middleware
    for (const mw of this._middleware) {
      try {
        await mw(envelope);
      } catch (err) {
        return {
          success: false,
          error: "MIDDLEWARE_ERROR",
          details: err.message,
        };
      }
    }

    // Dispatch to specific handlers
    const results = [];
    const specificHandlers = this._subscribers.get(event) || [];
    const wildcardHandlers = this._subscribers.get("*") || [];

    for (const sub of [...specificHandlers, ...wildcardHandlers]) {
      try {
        const result = await sub.handler(envelope);
        results.push({ subscriberId: sub.id, success: true, result });
        if (sub.once) {
          this._subscribers.get(event)?.splice(
            this._subscribers.get(event).indexOf(sub), 1
          );
        }
      } catch (err) {
        results.push({ subscriberId: sub.id, success: false, error: err.message });
      }
    }

    return {
      success: true,
      event,
      results,
      totalHandlers: specificHandlers.length + wildcardHandlers.length,
    };
  }

  /**
   * Get all registered events.
   */
  registeredEvents() {
    return Array.from(this._subscribers.keys());
  }

  /**
   * Get subscriber count for an event.
   */
  subscriberCount(event) {
    return (this._subscribers.get(event) || []).length;
  }

  /**
   * Clear all subscribers (useful for testing).
   */
  clear() {
    this._subscribers.clear();
    this._middleware = [];
  }
}

// Singleton instance for the app
let _instance = null;
function getEventBus() {
  if (!_instance) {
    _instance = new EventBus();
  }
  return _instance;
}

function resetEventBus() {
  _instance = null;
}

module.exports = { EventBus, getEventBus, resetEventBus };
