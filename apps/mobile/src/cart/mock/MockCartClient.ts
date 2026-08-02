import type {
  AddItemPayload,
  Cart,
  CartItem,
  CartResponse,
  EmptyCartResponse,
  UpdateQuantityPayload,
} from '../contracts';

const MOCK_PRODUCT_SNAPSHOT = {
  id: '1',
  title: 'Polo Pima Marinho',
  brand: 'Osklen',
  category_label: 'Polos',
  color: 'Marinho',
  size: 'M',
  sku: 'POLO-PIMA-MAR-M',
  primary_image: {
    url: 'https://cdn.aerostore.com/products/polo-pima-marinho.jpg',
    alt: 'Polo Pima Marinho',
    sort_order: 0,
    role: 'primary'
  }
};

const MOCK_PRODUCT_SNAPSHOT_2 = {
  id: '2',
  title: 'Camisa Social Branca',
  brand: 'AEROSTORE',
  category_label: 'Camisas',
  color: 'Branco',
  size: 'G',
  sku: 'CAMISA-BRANCA-G',
  primary_image: {
    url: 'https://cdn.aerostore.com/products/camisa-social-branca.jpg',
    alt: 'Camisa Social Branca',
    sort_order: 0,
    role: 'primary'
  }
};

function generateId(): string {
  return `mock-${Math.random().toString(36).slice(2, 10)}`;
}

function iso(): string {
  return new Date().toISOString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockCartClient {
  private cart: Cart | null = null;
  private latencyMs: number;
  private failConfig: { code: string; status: number } | null = null;

  constructor(latencyMs: number = 0) {
    this.latencyMs = latencyMs;
  }

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  setFail(code: string, status: number): void {
    this.failConfig = { code, status };
  }

  clearFail(): void {
    this.failConfig = null;
  }

  reset(): void {
    this.cart = null;
    this.failConfig = null;
  }

  private checkFail(): void {
    if (this.failConfig) {
      throw { status: this.failConfig.status, message: this.failConfig.code };
    }
  }

  async getCart(): Promise<CartResponse | EmptyCartResponse> {
    await wait(this.latencyMs);
    this.checkFail();
    if (!this.cart) {
      return {
        success: true,
        data: { cart: null, items: [] },
        meta: { api_version: 'v1' }
      };
    }
    return {
      success: true,
      data: { cart: this.cart, items: this.cart.items },
      meta: { api_version: 'v1' }
    };
  }

  async addItem(payload: AddItemPayload): Promise<CartResponse> {
    await wait(this.latencyMs);
    this.checkFail();

    if (!payload.product_id) {
      throw { status: 400, code: 'PRODUCT_ID_REQUIRED', message: 'product_id e obrigatorio.' };
    }

    const snapshot = payload.product_id === '2' ? MOCK_PRODUCT_SNAPSHOT_2 : MOCK_PRODUCT_SNAPSHOT;
    const effectivePriceCents = 45990;
    const unitPriceCents = 45990;
    const quantity = payload.quantity || 1;

    if (!this.cart) {
      this.cart = {
        id: generateId(),
        status: 'ACTIVE',
        currency: 'BRL',
        item_count: 0,
        subtotal_cents: 0,
        version: 1,
        updated_at: iso(),
        items: []
      };
    }

    // Verificar se já existe
    const existingIdx = this.cart.items.findIndex(
      (item) => item.product_id === payload.product_id && item.variant_id === (payload.variant_id || `${payload.product_id}-default`)
    );

    if (existingIdx >= 0) {
      const existing = this.cart.items[existingIdx];
      const newQty = Math.min(existing.quantity + quantity, 99);
      const newLineTotal = effectivePriceCents * newQty;
      this.cart.items[existingIdx] = {
        ...existing,
        quantity: newQty,
        line_total_cents: newLineTotal,
        version: existing.version + 1,
        updated_at: iso()
      };
    } else {
      const newItem: CartItem = {
        id: generateId(),
        product_id: payload.product_id,
        variant_id: payload.variant_id || `${payload.product_id}-default`,
        quantity,
        unit_price_cents: unitPriceCents,
        promotional_price_cents: null,
        effective_unit_price_cents: effectivePriceCents,
        line_total_cents: effectivePriceCents * quantity,
        availability: 'in_stock',
        version: 1,
        updated_at: iso(),
        product: snapshot
      };
      this.cart.items.push(newItem);
    }

    this.cart.item_count = this.cart.items.length;
    this.cart.subtotal_cents = this.cart.items.reduce((sum, item) => sum + item.line_total_cents, 0);
    this.cart.updated_at = iso();

    return {
      success: true,
      data: { cart: this.cart, items: this.cart.items },
      meta: { api_version: 'v1' }
    };
  }

  async updateQuantity(itemId: string, payload: UpdateQuantityPayload): Promise<CartResponse> {
    await wait(this.latencyMs);
    this.checkFail();

    if (!this.cart) {
      throw { status: 404, code: 'CART_NOT_FOUND', message: 'Carrinho nao encontrado.' };
    }

    const itemIdx = this.cart.items.findIndex((item) => item.id === itemId);
    if (itemIdx < 0) {
      throw { status: 404, code: 'CART_ITEM_NOT_FOUND', message: 'Item nao encontrado no carrinho.' };
    }

    const item = this.cart.items[itemIdx];
    const newQty = Math.max(1, Math.min(payload.quantity, 99));
    const newLineTotal = item.effective_unit_price_cents * newQty;

    this.cart.items[itemIdx] = {
      ...item,
      quantity: newQty,
      line_total_cents: newLineTotal,
      version: item.version + 1,
      updated_at: iso()
    };

    this.cart.item_count = this.cart.items.length;
    this.cart.subtotal_cents = this.cart.items.reduce((sum, i) => sum + i.line_total_cents, 0);
    this.cart.updated_at = iso();

    return {
      success: true,
      data: { cart: this.cart, items: this.cart.items },
      meta: { api_version: 'v1' }
    };
  }

  async removeItem(itemId: string): Promise<CartResponse> {
    await wait(this.latencyMs);
    this.checkFail();

    if (!this.cart) {
      throw { status: 404, code: 'CART_NOT_FOUND', message: 'Carrinho nao encontrado.' };
    }

    const itemIdx = this.cart.items.findIndex((item) => item.id === itemId);
    if (itemIdx < 0) {
      throw { status: 404, code: 'CART_ITEM_NOT_FOUND', message: 'Item nao encontrado no carrinho.' };
    }

    this.cart.items.splice(itemIdx, 1);
    this.cart.item_count = this.cart.items.length;
    this.cart.subtotal_cents = this.cart.items.reduce((sum, i) => sum + i.line_total_cents, 0);
    this.cart.updated_at = iso();

    return {
      success: true,
      data: { cart: this.cart, items: this.cart.items },
      meta: { api_version: 'v1' }
    };
  }

  async clearCart(): Promise<CartResponse> {
    await wait(this.latencyMs);
    this.checkFail();

    if (!this.cart) {
      throw { status: 404, code: 'CART_NOT_FOUND', message: 'Carrinho nao encontrado.' };
    }

    this.cart.items = [];
    this.cart.item_count = 0;
    this.cart.subtotal_cents = 0;
    this.cart.updated_at = iso();

    return {
      success: true,
      data: { cart: this.cart, items: [] },
      meta: { api_version: 'v1' }
    };
  }

  async closeCart(): Promise<CartResponse> {
    await wait(this.latencyMs);
    this.checkFail();

    if (!this.cart) {
      throw { status: 404, code: 'CART_NOT_FOUND', message: 'Carrinho nao encontrado.' };
    }

    const closedCart: Cart = {
      ...this.cart,
      status: 'CLOSED',
      items: [],
      updated_at: iso()
    };

    return {
      success: true,
      data: { cart: closedCart, items: [] },
      meta: { api_version: 'v1' }
    };
  }
}
