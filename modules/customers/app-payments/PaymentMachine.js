"use strict";

const STATES = {
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  PAYMENT_PROCESSING: "PAYMENT_PROCESSING",
  PAID: "PAID",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_CANCELLED: "PAYMENT_CANCELLED",
  PAYMENT_EXPIRED: "PAYMENT_EXPIRED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED"
};

const TRANSITIONS = {
  [STATES.AWAITING_PAYMENT]: {
    [STATES.PAYMENT_PROCESSING]: true,
    [STATES.PAYMENT_FAILED]: true,
    [STATES.PAYMENT_CANCELLED]: true,
    [STATES.PAYMENT_EXPIRED]: true
  },
  [STATES.PAYMENT_PROCESSING]: {
    [STATES.PAID]: true,
    [STATES.PAYMENT_FAILED]: true,
    [STATES.PAYMENT_CANCELLED]: true,
    [STATES.PAYMENT_EXPIRED]: true,
    [STATES.AWAITING_PAYMENT]: true
  },
  [STATES.PAID]: {
    [STATES.REFUNDED]: true,
    [STATES.PARTIALLY_REFUNDED]: true
  },
  [STATES.PAYMENT_FAILED]: {},
  [STATES.PAYMENT_CANCELLED]: {},
  [STATES.PAYMENT_EXPIRED]: {},
  [STATES.REFUNDED]: {},
  [STATES.PARTIALLY_REFUNDED]: {
    [STATES.REFUNDED]: true
  }
};

const EVENTS = {
  PAYMENT_CREATED: "PAYMENT_CREATED",
  PAYMENT_PENDING: "PAYMENT_PENDING",
  PAYMENT_APPROVED: "PAYMENT_APPROVED",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  PAYMENT_CANCELLED: "PAYMENT_CANCELLED",
  PAYMENT_EXPIRED: "PAYMENT_EXPIRED",
  PAYMENT_REFUNDED: "PAYMENT_REFUNDED",
  WEBHOOK_RECEIVED: "WEBHOOK_RECEIVED",
  WEBHOOK_IGNORED: "WEBHOOK_IGNORED",
  WEBHOOK_DUPLICATED: "WEBHOOK_DUPLICATED",
  RECONCILIATION_COMPLETED: "RECONCILIATION_COMPLETED"
};

class PaymentMachine {
  constructor(currentState) {
    this._state = currentState || STATES.AWAITING_PAYMENT;
    this._history = [];
  }

  get state() {
    return this._state;
  }

  get history() {
    return [...this._history];
  }

  canTransitionTo(targetState) {
    const allowed = TRANSITIONS[this._state];
    if (!allowed) return false;
    return !!allowed[targetState];
  }

  transition(targetState, reason, metadata = {}) {
    const allowed = TRANSITIONS[this._state];
    if (!allowed || !allowed[targetState]) {
      return {
        success: false,
        error: "INVALID_TRANSITION",
        from: this._state,
        to: targetState,
        message: `Cannot transition from ${this._state} to ${targetState}`
      };
    }
    this._history.push({
      from: this._state,
      to: targetState,
      reason: reason || null,
      metadata,
      at: new Date().toISOString()
    });
    this._state = targetState;
    return { success: true, from: this._history[this._history.length - 1].from, to: this._state };
  }

  transitionByEvent(event, metadata = {}) {
    const eventToState = {
      [EVENTS.PAYMENT_CREATED]: STATES.AWAITING_PAYMENT,
      [EVENTS.PAYMENT_PENDING]: STATES.PAYMENT_PROCESSING,
      [EVENTS.PAYMENT_APPROVED]: STATES.PAID,
      [EVENTS.PAYMENT_FAILED]: STATES.PAYMENT_FAILED,
      [EVENTS.PAYMENT_CANCELLED]: STATES.PAYMENT_CANCELLED,
      [EVENTS.PAYMENT_EXPIRED]: STATES.PAYMENT_EXPIRED,
      [EVENTS.PAYMENT_REFUNDED]: STATES.REFUNDED
    };
    const targetState = eventToState[event];
    if (!targetState) {
      return { success: false, error: "UNKNOWN_EVENT", event };
    }
    return this.transition(targetState, event, metadata);
  }

  static get STATES() { return STATES; }
  static get EVENTS() { return EVENTS; }
  static get TRANSITIONS() { return TRANSITIONS; }

  static isValidState(state) {
    return Object.values(STATES).includes(state);
  }
}

module.exports = { PaymentMachine, STATES, EVENTS, TRANSITIONS };
