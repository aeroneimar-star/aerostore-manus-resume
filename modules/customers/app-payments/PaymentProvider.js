"use strict";

class PaymentProvider {
  constructor(name) {
    this.name = name;
  }

  async createPayment(payment) { throw new Error("NOT_IMPLEMENTED:createPayment"); }
  async cancelPayment(paymentId, reason) { throw new Error("NOT_IMPLEMENTED:cancelPayment"); }
  async expirePayment(paymentId) { throw new Error("NOT_IMPLEMENTED:expirePayment"); }
  async queryPayment(paymentId) { throw new Error("NOT_IMPLEMENTED:queryPayment"); }
  async processWebhook(payload, signature) { throw new Error("NOT_IMPLEMENTED:processWebhook"); }
  async validateWebhook(payload, signature) { throw new Error("NOT_IMPLEMENTED:validateWebhook"); }
  async health() { return { provider: this.name, healthy: false, message: "NOT_IMPLEMENTED" }; }
}

module.exports = { PaymentProvider };
