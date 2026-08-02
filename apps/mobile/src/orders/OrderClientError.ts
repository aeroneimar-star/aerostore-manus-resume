export type OrderErrorCode =
  | 'UNAUTHORIZED'
  | 'SESSION_EXPIRED'
  | 'VALIDATION_ERROR'
  | 'STOCK_UNAVAILABLE'
  | 'FULFILLMENT_INVALID'
  | 'ADDRESS_NOT_FOUND'
  | 'PICKUP_STORE_INVALID'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_EXISTS'
  | 'ORDER_CREATION_FAILED'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'INVALID_RESPONSE';

export class OrderClientError extends Error {
  readonly code: OrderErrorCode;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: OrderErrorCode,
    message: string,
    options: { status?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'OrderClientError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export function toOrderClientError(error: unknown): OrderClientError {
  if (error instanceof OrderClientError) return error;
  if (error && typeof error === 'object') {
    const e = error as { status?: number; code?: string; message?: string };
    if (e.status === 401) return new OrderClientError('SESSION_EXPIRED', 'Sua sessão expirou.', { status: 401 });
    if (e.status === 403) return new OrderClientError('UNAUTHORIZED', 'Acesso restrito.', { status: 403 });
    if (e.status === 404) return new OrderClientError('ORDER_NOT_FOUND', 'Pedido não encontrado.', { status: 404 });
    if (e.status === 409) return new OrderClientError('ORDER_ALREADY_EXISTS', 'Este pedido já foi criado.', { status: 409 });
    if (e.status === 400) {
      const code = e.code === 'STOCK_UNAVAILABLE' ? 'STOCK_UNAVAILABLE' : 'VALIDATION_ERROR';
      return new OrderClientError(code, e.message || 'Dados inválidos.', { status: 400 });
    }
    if (e.status === 500) return new OrderClientError('INTERNAL_ERROR', 'Erro interno do servidor.', { status: 500 });
  }
  return new OrderClientError('NETWORK_ERROR', 'Não foi possível conectar ao servidor.');
}
