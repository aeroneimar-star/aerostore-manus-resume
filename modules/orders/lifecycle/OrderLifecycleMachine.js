"use strict";

/**
 * Order Lifecycle Machine
 * Finite state machine controlling the full order lifecycle.
 * No module may change status directly — all transitions pass through this machine.
 */

const STATES = Object.freeze({
  CREATED: "CREATED",
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  PAYMENT_PROCESSING: "PAYMENT_PROCESSING",
  PAID: "PAID",
  RESERVED: "RESERVED",
  PICKING: "PICKING",
  PACKED: "PACKED",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  READY_TO_SHIP: "READY_TO_SHIP",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  RETURN_REQUESTED: "RETURN_REQUESTED",
  RETURN_APPROVED: "RETURN_APPROVED",
  RETURN_REJECTED: "RETURN_REJECTED",
  RETURN_RECEIVED: "RETURN_RECEIVED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
});

const EVENTS = Object.freeze({
  ORDER_CREATED: "ORDER_CREATED",
  PAYMENT_CONFIRMED: "PAYMENT_CONFIRMED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  RESERVATION_CONSUMED: "RESERVATION_CONSUMED",
  PICKING_STARTED: "PICKING_STARTED",
  PICKING_COMPLETED: "PICKING_COMPLETED",
  PACKED: "PACKED",
  READY_FOR_PICKUP: "READY_FOR_PICKUP",
  READY_TO_SHIP: "READY_TO_SHIP",
  SHIPPED: "SHIPPED",
  DELIVERED: "DELIVERED",
  RETURN_REQUESTED: "RETURN_REQUESTED",
  RETURN_APPROVED: "RETURN_APPROVED",
  RETURN_REJECTED: "RETURN_REJECTED",
  RETURN_RECEIVED: "RETURN_RECEIVED",
  REFUND_COMPLETED: "REFUND_COMPLETED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
});

/**
 * Transition map: [fromState][event] = toState
 * Null/undefined means invalid transition.
 */
const TRANSITIONS = Object.freeze({
  [STATES.CREATED]: {
    [EVENTS.ORDER_CREATED]: STATES.AWAITING_PAYMENT,
    [EVENTS.ORDER_CANCELLED]: STATES.CANCELLED,
  },
  [STATES.AWAITING_PAYMENT]: {
    [EVENTS.PAYMENT_CONFIRMED]: STATES.PAID,
    [EVENTS.PAYMENT_FAILED]: STATES.AWAITING_PAYMENT,
    [EVENTS.ORDER_CANCELLED]: STATES.CANCELLED,
  },
  [STATES.PAYMENT_PROCESSING]: {
    [EVENTS.PAYMENT_CONFIRMED]: STATES.PAID,
    [EVENTS.PAYMENT_FAILED]: STATES.AWAITING_PAYMENT,
    [EVENTS.ORDER_CANCELLED]: STATES.CANCELLED,
  },
  [STATES.PAID]: {
    [EVENTS.RESERVATION_CONSUMED]: STATES.RESERVED,
    [EVENTS.ORDER_CANCELLED]: STATES.CANCELLED,
  },
  [STATES.RESERVED]: {
    [EVENTS.PICKING_STARTED]: STATES.PICKING,
    [EVENTS.ORDER_CANCELLED]: STATES.CANCELLED,
  },
  [STATES.PICKING]: {
    [EVENTS.PICKING_COMPLETED]: STATES.PACKED,
  },
  [STATES.PACKED]: {
    [EVENTS.READY_FOR_PICKUP]: STATES.READY_FOR_PICKUP,
    [EVENTS.READY_TO_SHIP]: STATES.READY_TO_SHIP,
  },
  [STATES.READY_FOR_PICKUP]: {
    [EVENTS.DELIVERED]: STATES.DELIVERED,
  },
  [STATES.READY_TO_SHIP]: {
    [EVENTS.SHIPPED]: STATES.SHIPPED,
  },
  [STATES.SHIPPED]: {
    [EVENTS.DELIVERED]: STATES.DELIVERED,
  },
  [STATES.DELIVERED]: {
    [EVENTS.RETURN_REQUESTED]: STATES.RETURN_REQUESTED,
  },
  [STATES.RETURN_REQUESTED]: {
    [EVENTS.RETURN_APPROVED]: STATES.RETURN_APPROVED,
    [EVENTS.RETURN_REJECTED]: STATES.RETURN_REJECTED,
    [EVENTS.ORDER_CANCELLED]: STATES.CANCELLED,
  },
  [STATES.RETURN_APPROVED]: {
    [EVENTS.RETURN_RECEIVED]: STATES.RETURN_RECEIVED,
  },
  [STATES.RETURN_REJECTED]: {},
  [STATES.RETURN_RECEIVED]: {
    [EVENTS.REFUND_COMPLETED]: STATES.REFUNDED,
  },
  [STATES.REFUNDED]: {},
  [STATES.PARTIALLY_REFUNDED]: {
    [EVENTS.REFUND_COMPLETED]: STATES.REFUNDED,
  },
  [STATES.CANCELLED]: {},
});

class OrderLifecycleMachine {
  constructor(initialState = STATES.CREATED) {
    if (!Object.values(STATES).includes(initialState)) {
      throw new Error(`INVALID_STATE: ${initialState}`);
    }
    this._state = initialState;
    this._history = [];
  }

  get state() {
    return this._state;
  }

  get history() {
    return [...this._history];
  }

  /**
   * Attempt a transition.
   * Returns { success, from, to, event }
   * Throws on invalid state or invalid transition.
   */
  transition(event, metadata = {}) {
    if (!Object.values(EVENTS).includes(event)) {
      throw new Error(`INVALID_EVENT: ${event}`);
    }

    const fromState = this._state;
    const availableTransitions = TRANSITIONS[fromState] || {};
    const toState = availableTransitions[event];

    if (toState === undefined || toState === null) {
      return {
        success: false,
        error: "INVALID_TRANSITION",
        message: `Cannot transition from ${fromState} via ${event}`,
        from: fromState,
        event,
      };
    }

    this._history.push({
      from: fromState,
      to: toState,
      event,
      metadata: { ...metadata },
      at: new Date().toISOString(),
    });

    this._state = toState;

    return {
      success: true,
      from: fromState,
      to: toState,
      event,
      metadata,
    };
  }

  /**
   * Check if a transition is valid without applying it.
   */
  canTransition(event) {
    const fromState = this._state;
    const availableTransitions = TRANSITIONS[fromState] || {};
    return availableTransitions[event] !== undefined && availableTransitions[event] !== null;
  }

  /**
   * Get all valid next events from current state.
   */
  availableEvents() {
    const fromState = this._state;
    const availableTransitions = TRANSITIONS[fromState] || {};
    return Object.keys(availableTransitions);
  }

  /**
   * Check if current state is terminal (no outgoing transitions).
   */
  isTerminal() {
    return this.availableEvents().length === 0;
  }

  /**
   * Serialize machine state.
   */
  toJSON() {
    return {
      state: this._state,
      history: [...this._history],
    };
  }
}

module.exports = {
  OrderLifecycleMachine,
  STATES,
  EVENTS,
  TRANSITIONS,
};
