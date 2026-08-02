"use strict";

const assert = require("assert");
const {
  OrderLifecycleMachine,
  STATES,
  EVENTS,
  EventBus,
  createOrderLifecycleService,
  OrderLifecycleEngine,
  TimelineService,
  ReturnService,
  createReturnService,
  MockTrackingProvider,
  createNotificationEventEmitter,
  LifecycleError,
  formatStatusForDisplay,
  formatStatusColor,
  formatCentsBrl,
} = require("../index");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ============================================================
console.log("\n=== OrderLifecycleMachine Tests ===");
// ============================================================

test("should create machine with CREATED state", () => {
  const m = new OrderLifecycleMachine(STATES.CREATED);
  assert.strictEqual(m.state, STATES.CREATED);
});

test("should reject invalid initial state", () => {
  assert.throws(() => new OrderLifecycleMachine("INVALID_STATE"));
});

test("should transition from CREATED to AWAITING_PAYMENT", () => {
  const m = new OrderLifecycleMachine(STATES.CREATED);
  const result = m.transition(EVENTS.ORDER_CREATED);
  assert.ok(result.success);
  assert.strictEqual(m.state, STATES.AWAITING_PAYMENT);
});

test("should record history on transition", () => {
  const m = new OrderLifecycleMachine(STATES.CREATED);
  m.transition(EVENTS.ORDER_CREATED);
  const h = m.history;
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].from, STATES.CREATED);
  assert.strictEqual(h[0].to, STATES.AWAITING_PAYMENT);
  assert.strictEqual(h[0].event, EVENTS.ORDER_CREATED);
});

test("should reject invalid event", () => {
  const m = new OrderLifecycleMachine(STATES.CREATED);
  assert.throws(() => m.transition("INVALID_EVENT"));
});

test("should return success:false for invalid transition", () => {
  const m = new OrderLifecycleMachine(STATES.DELIVERED);
  const result = m.transition(EVENTS.ORDER_CREATED);
  assert.ok(!result.success);
  assert.strictEqual(result.error, "INVALID_TRANSITION");
});

test("should transition AWAITING_PAYMENT -> PAID on PAYMENT_CONFIRMED", () => {
  const m = new OrderLifecycleMachine(STATES.AWAITING_PAYMENT);
  const r = m.transition(EVENTS.PAYMENT_CONFIRMED);
  assert.ok(r.success);
  assert.strictEqual(m.state, STATES.PAID);
});

test("should handle PAYMENT_FAILED -> AWAITING_PAYMENT retry", () => {
  const m = new OrderLifecycleMachine(STATES.AWAITING_PAYMENT);
  m.transition(EVENTS.PAYMENT_FAILED);
  assert.strictEqual(m.state, STATES.AWAITING_PAYMENT);
});

test("should transition PAID -> RESERVED on RESERVATION_CONSUMED", () => {
  const m = new OrderLifecycleMachine(STATES.PAID);
  const r = m.transition(EVENTS.RESERVATION_CONSUMED);
  assert.ok(r.success);
  assert.strictEqual(m.state, STATES.RESERVED);
});

test("should transition RESERVED -> PICKING on PICKING_STARTED", () => {
  const m = new OrderLifecycleMachine(STATES.RESERVED);
  const r = m.transition(EVENTS.PICKING_STARTED);
  assert.ok(r.success);
  assert.strictEqual(m.state, STATES.PICKING);
});

test("should transition PICKING -> PACKED on PICKING_COMPLETED", () => {
  const m = new OrderLifecycleMachine(STATES.PICKING);
  const r = m.transition(EVENTS.PICKING_COMPLETED);
  assert.ok(r.success);
  assert.strictEqual(m.state, STATES.PACKED);
});

test("should transition PACKED -> READY_FOR_PICKUP or READY_TO_SHIP", () => {
  const m1 = new OrderLifecycleMachine(STATES.PACKED);
  m1.transition(EVENTS.READY_FOR_PICKUP);
  assert.strictEqual(m1.state, STATES.READY_FOR_PICKUP);

  const m2 = new OrderLifecycleMachine(STATES.PACKED);
  m2.transition(EVENTS.READY_TO_SHIP);
  assert.strictEqual(m2.state, STATES.READY_TO_SHIP);
});

test("should transition READY_TO_SHIP -> SHIPPED -> DELIVERED", () => {
  const m = new OrderLifecycleMachine(STATES.READY_TO_SHIP);
  m.transition(EVENTS.SHIPPED);
  assert.strictEqual(m.state, STATES.SHIPPED);
  m.transition(EVENTS.DELIVERED);
  assert.strictEqual(m.state, STATES.DELIVERED);
});

test("should transition DELIVERED -> RETURN_REQUESTED", () => {
  const m = new OrderLifecycleMachine(STATES.DELIVERED);
  const r = m.transition(EVENTS.RETURN_REQUESTED);
  assert.ok(r.success);
  assert.strictEqual(m.state, STATES.RETURN_REQUESTED);
});

test("should transition RETURN_REQUESTED -> RETURN_APPROVED -> RETURN_RECEIVED -> REFUNDED", () => {
  const m = new OrderLifecycleMachine(STATES.RETURN_REQUESTED);
  m.transition(EVENTS.RETURN_APPROVED);
  assert.strictEqual(m.state, STATES.RETURN_APPROVED);
  m.transition(EVENTS.RETURN_RECEIVED);
  assert.strictEqual(m.state, STATES.RETURN_RECEIVED);
  m.transition(EVENTS.REFUND_COMPLETED);
  assert.strictEqual(m.state, STATES.REFUNDED);
});

test("should transition RETURN_REQUESTED -> RETURN_REJECTED", () => {
  const m = new OrderLifecycleMachine(STATES.RETURN_REQUESTED);
  m.transition(EVENTS.RETURN_REJECTED);
  assert.strictEqual(m.state, STATES.RETURN_REJECTED);
});

test("should cancel from multiple states", () => {
  for (const state of [STATES.CREATED, STATES.AWAITING_PAYMENT, STATES.PAID, STATES.RESERVED]) {
    const m = new OrderLifecycleMachine(state);
    m.transition(EVENTS.ORDER_CANCELLED);
    assert.strictEqual(m.state, STATES.CANCELLED, `Failed from ${state}`);
  }
});

test("should detect terminal states", () => {
  const terminal = [STATES.CANCELLED, STATES.REFUNDED, STATES.RETURN_REJECTED];
  for (const state of terminal) {
    const m = new OrderLifecycleMachine(state);
    assert.ok(m.isTerminal(), `${state} should be terminal`);
  }
});

test("should list available events", () => {
  const m = new OrderLifecycleMachine(STATES.PACKED);
  const events = m.availableEvents();
  assert.ok(events.includes(EVENTS.READY_FOR_PICKUP));
  assert.ok(events.includes(EVENTS.READY_TO_SHIP));
});

test("should serialize to JSON", () => {
  const m = new OrderLifecycleMachine(STATES.PAID);
  m.transition(EVENTS.RESERVATION_CONSUMED);
  const json = m.toJSON();
  assert.strictEqual(json.state, STATES.RESERVED);
  assert.ok(json.history.length > 0);
});

// ============================================================
console.log("\n=== EventBus Tests ===");
// ============================================================

test("should subscribe and emit events", async () => {
  await asyncTest("subscribe and emit", async () => {
    const bus = new EventBus();
    let received = false;
    bus.on("TEST_EVENT", () => { received = true; });
    await bus.emit("TEST_EVENT");
    assert.ok(received);
  });
});

test("should pass payload to handlers", async () => {
  await asyncTest("payload passing", async () => {
    const bus = new EventBus();
    let payload = null;
    bus.on("TEST", (envelope) => { payload = envelope.payload; });
    await bus.emit("TEST", { orderId: "123" });
    assert.strictEqual(payload.orderId, "123");
  });
});

test("should support wildcard handlers", async () => {
  await asyncTest("wildcard handlers", async () => {
    const bus = new EventBus();
    let count = 0;
    bus.onAll(() => { count++; });
    bus.on("SPECIFIC", () => {});
    await bus.emit("SPECIFIC");
    // The wildcard handler subscribes to "*" but emit dispatches "SPECIFIC"
    // The emit method dispatches both specific and wildcard handlers
    // Check that the wildcard handler was called at least once
    assert.ok(count >= 1, `Wildcard handler should be called, got ${count}`);
  });
});

test("should support once handlers", async () => {
  await asyncTest("once handlers", async () => {
    const bus = new EventBus();
    let count = 0;
    bus.on("TEST", () => { count++; }, { once: true });
    await bus.emit("TEST");
    await bus.emit("TEST");
    assert.strictEqual(count, 1);
  });
});

test("should return unsubscribe function", async () => {
  await asyncTest("unsubscribe", async () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.on("TEST", () => { count++; });
    await bus.emit("TEST");
    unsub();
    await bus.emit("TEST");
    assert.strictEqual(count, 1);
  });
});

test("should support middleware", async () => {
  await asyncTest("middleware", async () => {
    const bus = new EventBus();
    let mwExecuted = false;
    bus.use((envelope) => { mwExecuted = true; });
    await bus.emit("TEST");
    assert.ok(mwExecuted);
  });
});

// ============================================================
console.log("\n=== TimelineService Tests ===");
// ============================================================

test("should record timeline entries", async () => {
  await asyncTest("record entries", async () => {
    const ts = new TimelineService();
    const entry = await ts.record({
      orderId: "ORD-1",
      status: "PAID",
      event: "PAYMENT_CONFIRMED",
      description: "Pagamento confirmado",
      type: "CUSTOMER",
      visibleToCustomer: true,
      icon: "payment",
    });
    assert.ok(entry.id);
    assert.strictEqual(entry.status, "PAID");
  });
});

test("should filter customer-visible entries", async () => {
  await asyncTest("filter customer visible", async () => {
    const ts = new TimelineService();
    await ts.record({ orderId: "ORD-1", status: "PAID", event: "PAYMENT_CONFIRMED", description: "Pago", type: "CUSTOMER", visibleToCustomer: true, icon: "payment" });
    await ts.record({ orderId: "ORD-1", status: "RESERVED", event: "RESERVATION_CONSUMED", description: "Reserva", type: "INTERNAL", visibleToCustomer: false, icon: "inventory" });
    const customer = ts.getCustomerVisible("ORD-1");
    assert.strictEqual(customer.length, 1);
    assert.strictEqual(customer[0].status, "PAID");
  });
});

test("should return current status", async () => {
  await asyncTest("current status", async () => {
    const ts = new TimelineService();
    await ts.record({ orderId: "ORD-1", status: "SHIPPED", event: "SHIPPED", description: "Enviado", icon: "truck" });
    const current = ts.getCurrentStatus("ORD-1");
    assert.strictEqual(current.status, "SHIPPED");
  });
});

test("should compute fulfillment step", async () => {
  await asyncTest("fulfillment step", async () => {
    const ts = new TimelineService();
    await ts.record({ orderId: "ORD-1", status: "SHIPPED", event: "SHIPPED", description: "Enviado", icon: "truck" });
    const step = ts.getFulfillmentStep("ORD-1");
    assert.ok(step.step > 0);
    assert.strictEqual(step.label, "Enviado");
    assert.strictEqual(step.nextLabel, "Entregue");
  });
});

// ============================================================
console.log("\n=== ReturnService Tests ===");
// ============================================================

test("should request a return", async () => {
  await asyncTest("request return", async () => {
    const rs = new ReturnService();
    const ret = await rs.requestReturn("ORD-1", {
      items: [{ productId: "PRD-1", quantity: 1 }],
      reason: "WRONG_SIZE",
      description: "Tamanho incorreto",
    });
    assert.ok(ret.id);
    assert.strictEqual(ret.status, "REQUESTED");
    assert.strictEqual(ret.reason, "WRONG_SIZE");
  });
});

test("should reject invalid return reason", async () => {
  await asyncTest("reject invalid reason", async () => {
    const rs = new ReturnService();
    await assert.rejects(() => rs.requestReturn("ORD-1", {
      items: [{ productId: "PRD-1", quantity: 1 }],
      reason: "INVALID_REASON",
    }));
  });
});

test("should approve return", async () => {
  await asyncTest("approve return", async () => {
    const rs = new ReturnService();
    const ret = await rs.requestReturn("ORD-1", { items: [{ productId: "P1", quantity: 1 }], reason: "DEFECTIVE" });
    const approved = await rs.approveReturn(ret.id);
    assert.strictEqual(approved.status, "APPROVED");
  });
});

test("should reject return", async () => {
  await asyncTest("reject return", async () => {
    const rs = new ReturnService();
    const ret = await rs.requestReturn("ORD-1", { items: [{ productId: "P1", quantity: 1 }], reason: "DID_NOT_LIKE" });
    const rejected = await rs.rejectReturn(ret.id, "Não é motivo válido");
    assert.strictEqual(rejected.status, "REJECTED");
  });
});

test("should mark return as received", async () => {
  await asyncTest("mark received", async () => {
    const rs = new ReturnService();
    const ret = await rs.requestReturn("ORD-1", { items: [{ productId: "P1", quantity: 1 }], reason: "DEFECTIVE" });
    await rs.approveReturn(ret.id);
    const received = await rs.markReceived(ret.id);
    assert.strictEqual(received.status, "ITEM_RECEIVED");
  });
});

test("should get returns by order", async () => {
  await asyncTest("get by order", async () => {
    const rs = new ReturnService();
    await rs.requestReturn("ORD-1", { items: [{ productId: "P1", quantity: 1 }], reason: "WRONG_ITEM" });
    await rs.requestReturn("ORD-1", { items: [{ productId: "P2", quantity: 1 }], reason: "DEFECTIVE" });
    const returns = rs.getReturnsByOrder("ORD-1");
    assert.strictEqual(returns.length, 2);
  });
});

// ============================================================
console.log("\n=== MockTrackingProvider Tests ===");
// ============================================================

test("should return mock tracking info", async () => {
  await asyncTest("mock tracking", async () => {
    const tp = new MockTrackingProvider();
    const info = await tp.getTracking("BR123AA");
    assert.ok(info.trackingCode);
    assert.ok(info.carrier);
    assert.ok(info.events.length > 0);
  });
});

test("should create mock label", async () => {
  await asyncTest("create label", async () => {
    const tp = new MockTrackingProvider();
    const label = await tp.createLabel({ orderId: "ORD-1" });
    assert.ok(label.trackingCode);
    assert.ok(label.labelUrl);
  });
});

test("should seed custom tracking data", async () => {
  await asyncTest("seed data", async () => {
    const tp = new MockTrackingProvider();
    tp.seed("CUSTOM-1", {
      trackingCode: "CUSTOM-1",
      carrier: "FedEx",
      status: "DELIVERED",
      events: [{ at: "2026-08-01", description: "Entregue" }],
    });
    const info = await tp.getTracking("CUSTOM-1");
    assert.strictEqual(info.status, "DELIVERED");
    assert.strictEqual(info.carrier, "FedEx");
  });
});

// ============================================================
console.log("\n=== OrderLifecycleService Tests ===");
// ============================================================

test("should create order and initialize lifecycle", async () => {
  await asyncTest("create order", async () => {
    const svc = createOrderLifecycleService();
    const order = await svc.createOrder({
      orderId: "ORD-TEST-001",
      orderNumber: "AERO-TEST001",
      totalAmountCents: 6500,
      items: [{ id: "P1", quantity: 1 }],
      fulfillmentType: "DELIVERY",
    });
    assert.strictEqual(order.status, "AWAITING_PAYMENT");
    assert.ok(order.orderNumber);
  });
});

test("should confirm payment and transition to PAID", async () => {
  await asyncTest("confirm payment", async () => {
    const svc = createOrderLifecycleService();
    await svc.createOrder({ orderId: "ORD-TEST-002", totalAmountCents: 5000 });
    await svc.engine.initOrder("ORD-TEST-002", {});
    const result = await svc.confirmPayment("ORD-TEST-002");
    assert.ok(result.success);
    assert.strictEqual(result.to, "PAID");
  });
});

test("should reject payment confirmation if order not found", async () => {
  await asyncTest("reject not found", async () => {
    const svc = createOrderLifecycleService();
    try {
      await svc.confirmPayment("NON-EXISTENT");
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err.message.includes("ORDER_NOT_FOUND"), `Expected ORDER_NOT_FOUND, got: ${err.message}`);
    }
  });
});

test("should cancel order", async () => {
  await asyncTest("cancel order", async () => {
    const svc = createOrderLifecycleService();
    await svc.engine.initOrder("ORD-CANCEL-001", {});
    const result = await svc.cancelOrder("ORD-CANCEL-001", "Cliente solicitou");
    assert.ok(result.success);
    assert.strictEqual(result.to, "CANCELLED");
  });
});

test("should get order state", async () => {
  await asyncTest("get state", async () => {
    const svc = createOrderLifecycleService();
    await svc.engine.initOrder("ORD-STATE-001", {});
    await svc.confirmPayment("ORD-STATE-001");
    const state = svc.getOrderState("ORD-STATE-001");
    assert.strictEqual(state.state, "PAID");
    assert.ok(state.statusLabel);
    assert.ok(state.statusColor);
  });
});

test("should get customer timeline", async () => {
  await asyncTest("customer timeline", async () => {
    const svc = createOrderLifecycleService();
    await svc.engine.initOrder("ORD-TL-001", {});
    await svc.confirmPayment("ORD-TL-001");
    await svc.startPicking("ORD-TL-001");
    await svc.completePicking("ORD-TL-001");
    await svc.markPacked("ORD-TL-001");
    await svc.markReadyToShip("ORD-TL-001");
    await svc.markShipped("ORD-TL-001");
    const timeline = svc.getCustomerTimeline("ORD-TL-001");
    // Should filter out internal events (PICKING_STARTED, PICKING_COMPLETED, PACKED, READY_TO_SHIP)
    assert.ok(timeline.length > 0);
    // PAYMENT_CONFIRMED should be visible
    const paid = timeline.find(e => e.event === "PAYMENT_CONFIRMED");
    assert.ok(paid);
  });
});

test("should get fulfillment step", async () => {
  await asyncTest("fulfillment step", async () => {
    const svc = createOrderLifecycleService();
    await svc.engine.initOrder("ORD-STEP-001", {});
    await svc.confirmPayment("ORD-STEP-001");
    await svc.engine.processEvent("ORD-STEP-001", EVENTS.RESERVATION_CONSUMED);
    await svc.startPicking("ORD-STEP-001");
    await svc.completePicking("ORD-STEP-001");
    await svc.markPacked("ORD-STEP-001");
    await svc.markReadyToShip("ORD-STEP-001");
    await svc.markShipped("ORD-STEP-001");
    await new Promise(r => setTimeout(r, 200));
    // getFulfillmentStep uses timelineService.getCurrentStatus which reads from timeline
    const step = svc.getFulfillmentStep("ORD-STEP-001");
    assert.ok(step.step > 0);
    // The last timeline entry should be SHIPPED (customer-visible)
    const fullTimeline = svc.getFullTimeline("ORD-STEP-001");
    const lastEntry = fullTimeline[fullTimeline.length - 1];
    assert.strictEqual(lastEntry.status, "SHIPPED");
    assert.strictEqual(step.label, "Enviado");
  });
});

test("should request return for delivered order", async () => {
  await asyncTest("request return delivered", async () => {
    const svc = createOrderLifecycleService();
    await svc.engine.initOrder("ORD-RET-001", {});
    await svc.confirmPayment("ORD-RET-001");
    await svc.startPicking("ORD-RET-001");
    await svc.completePicking("ORD-RET-001");
    await svc.markPacked("ORD-RET-001");
    await svc.markReadyToShip("ORD-RET-001");
    await svc.markShipped("ORD-RET-001");
    await svc.markDelivered("ORD-RET-001");
    const ret = await svc.requestReturn("ORD-RET-001", {
      items: [{ productId: "P1", quantity: 1 }],
      reason: "DEFECTIVE",
    });
    assert.ok(ret.id);
    assert.strictEqual(ret.status, "REQUESTED");
  });
});

test("should get pickup info for ready order", async () => {
  await asyncTest("pickup info", async () => {
    const svc = createOrderLifecycleService();
    await svc.engine.initOrder("ORD-PICKUP-001", {});
    await svc.confirmPayment("ORD-PICKUP-001");
    await svc.engine.processEvent("ORD-PICKUP-001", EVENTS.RESERVATION_CONSUMED);
    await svc.startPicking("ORD-PICKUP-001");
    await svc.completePicking("ORD-PICKUP-001");
    await svc.markPacked("ORD-PICKUP-001");
    await svc.markReadyForPickup("ORD-PICKUP-001");
    await new Promise(r => setTimeout(r, 200));
    // Verify state is READY_FOR_PICKUP
    const state = svc.engine.getState("ORD-PICKUP-001");
    assert.strictEqual(state.state, "READY_FOR_PICKUP");
    const info = svc.getPickupInfo("ORD-PICKUP-001", {
      name: "Loja AEROSTORE",
      address: "Av. Paulista, 1000",
      hours: "10h-20h",
    });
    assert.strictEqual(info.storeName, "Loja AEROSTORE");
    assert.ok(info.requiredDocument);
  });
});

test("should reject pickup info for non-ready order", async () => {
  await asyncTest("reject pickup non-ready", async () => {
    const svc = createOrderLifecycleService();
    await svc.engine.initOrder("ORD-NP-001", {});
    assert.throws(() => svc.getPickupInfo("ORD-NP-001"), (err) => {
      return err instanceof LifecycleError && err.code === "ORDER_NOT_READY_FOR_PICKUP";
    });
  });
});

test("should get tracking from mock provider", async () => {
  await asyncTest("tracking mock", async () => {
    const svc = createOrderLifecycleService();
    const info = await svc.getTracking("BR123AA");
    assert.ok(info.trackingCode);
    assert.ok(info.events.length > 0);
  });
});

// ============================================================
console.log("\n=== Concurrency & Idempotency Tests ===");
// ============================================================

async function concurrencyTest() {
  const svc = createOrderLifecycleService();
  await svc.engine.initOrder("ORD-CONC-001", {});
  await svc.confirmPayment("ORD-CONC-001");

  // Try to confirm payment again (idempotency)
  try {
    await svc.confirmPayment("ORD-CONC-001");
    assert.fail("Should have thrown");
  } catch (err) {
    // confirmPayment throws LifecycleError when transition fails
    assert.ok(
      err.message.includes("INVALID_TRANSITION") || err.code === "INVALID_TRANSITION",
      `Expected INVALID_TRANSITION error, got: ${err.message}`
    );
  }
  console.log("  ✓ idempotency: double payment confirm rejected");
  passed++;
}

async function invalidTransitionTest() {
  const svc = createOrderLifecycleService();
  await svc.engine.initOrder("ORD-INV-001", {});
  // Try to pick before payment
  const result = await svc.startPicking("ORD-INV-001");
  assert.ok(!result.success);
  console.log("  ✓ invalid transition: picking before payment rejected");
  passed++;
}

async function multipleCancelTest() {
  const svc = createOrderLifecycleService();
  await svc.engine.initOrder("ORD-MC-001", {});
  await svc.confirmPayment("ORD-MC-001");
  await svc.startPicking("ORD-MC-001");

  // Cancel from PICKING state
  const result = await svc.cancelOrder("ORD-MC-001", "Múltiplo cancelamento");
  assert.ok(result.success);
  assert.strictEqual(result.to, "CANCELLED");

  // Try to cancel again (should fail - terminal state)
  const result2 = await svc.cancelOrder("ORD-MC-001", "Segundo cancelamento");
  assert.ok(!result2.success);
  console.log("  ✓ multiple cancel: second cancel rejected");
  passed++;
}

asyncTest("concurrency: idempotent payment confirm", concurrencyTest);
asyncTest("invalid transition: picking before payment", invalidTransitionTest);
asyncTest("multiple cancel: terminal state protection", multipleCancelTest);

// ============================================================
console.log("\n=== DTO Tests ===");
// ============================================================

test("formatStatusForDisplay returns correct labels", () => {
  assert.strictEqual(formatStatusForDisplay("PAID"), "Pago");
  assert.strictEqual(formatStatusForDisplay("SHIPPED"), "Enviado");
  assert.strictEqual(formatStatusForDisplay("DELIVERED"), "Entregue");
  assert.strictEqual(formatStatusForDisplay("CANCELLED"), "Cancelado");
});

test("formatStatusColor returns correct colors", () => {
  assert.strictEqual(formatStatusColor("PAID"), "success");
  assert.strictEqual(formatStatusColor("CANCELLED"), "error");
  assert.strictEqual(formatStatusColor("AWAITING_PAYMENT"), "warning");
});

test("formatCentsBrl formats correctly", () => {
  assert.strictEqual(formatCentsBrl(6500), "R$ 65,00");
  assert.strictEqual(formatCentsBrl(8900), "R$ 89,00");
  assert.strictEqual(formatCentsBrl(0), "R$ 0,00");
  assert.strictEqual(formatCentsBrl(-1), "R$ 0,00");
});

// ============================================================
// Summary
// ============================================================

setTimeout(() => {
  console.log(`\n=== Summary ===`);
  console.log(`  Total: ${passed + failed}`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Verdict: ${failed === 0 ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}`);
  process.exit(failed > 0 ? 1 : 0);
}, 2000);
