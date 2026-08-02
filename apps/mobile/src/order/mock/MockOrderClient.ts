import { OrderClient } from "../OrderClient";
import {
  CreateOrderInput,
  CreateOrderResponse,
  OrderDetailResponse,
  OrderListResponse,
  ReleaseOrderResponse,
} from "../contracts";

function randomId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function formatCentsBrl(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
}

export class MockOrderClient implements OrderClient {
  private orders: Map<string, CreateOrderResponse["data"]> = new Map();

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResponse> {
    const orderId = randomId();
    const orderNumber = `AERO-2026-${String(this.orders.size + 1).padStart(9, "0")}`;
    const now = new Date().toISOString();

    const data = {
      order: {
        id: orderId,
        orderNumber,
        status: "AWAITING_PAYMENT" as const,
        fulfillmentType: "DELIVERY" as const,
        addressId: "addr-1",
        totalCents: 6500,
        subtotalCents: 5000,
        shippingQuoteCents: 1500,
        totalFormatted: formatCentsBrl(6500),
        subtotalFormatted: formatCentsBrl(5000),
        shippingFormatted: formatCentsBrl(1500),
        snapshotJson: JSON.stringify({ orderId, orderNumber }),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        createdAt: now,
        updatedAt: now,
      },
      items: [
        {
          id: randomId(),
          productId: "prod-1",
          variantId: "var-1",
          productName: "Camiseta Basica",
          variantName: "P/Preta",
          quantity: 2,
          unitPriceCents: 2500,
          effectiveUnitPriceCents: 2500,
          lineTotalCents: 5000,
        },
      ],
      duplicate: false,
      message: "Pedido criado com sucesso.",
    };

    this.orders.set(orderId, data);
    return { success: true, data, meta: { timestamp: now } };
  }

  async getOrder(orderId: string): Promise<OrderDetailResponse> {
    const stored = this.orders.get(orderId);
    if (!stored) {
      throw new Error("ORDER_NOT_FOUND");
    }
    return {
      success: true,
      data: { order: stored.order, items: stored.items },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  async listOrders(): Promise<OrderListResponse> {
    const orders = Array.from(this.orders.values()).map(o => o.order);
    return {
      success: true,
      data: { orders, count: orders.length },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  async releaseOrder(orderId: string): Promise<ReleaseOrderResponse> {
    const stored = this.orders.get(orderId);
    if (!stored) {
      throw new Error("ORDER_NOT_FOUND");
    }
    stored.order.status = "CANCELLED";
    return {
      success: true,
      data: { released: true, message: "Pedido cancelado." },
      meta: { timestamp: new Date().toISOString() },
    };
  }
}
