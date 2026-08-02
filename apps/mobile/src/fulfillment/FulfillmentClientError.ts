import type { FulfillmentErrorCode } from './contracts';

export class FulfillmentClientError extends Error {
  readonly code: FulfillmentErrorCode;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: FulfillmentErrorCode,
    message: string,
    options: { status?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'FulfillmentClientError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export function toFulfillmentClientError(error: unknown): FulfillmentClientError {
  if (error instanceof FulfillmentClientError) return error;
  if (error && typeof error === 'object' && 'status' in error && error.status === 401) {
    return new FulfillmentClientError('APP_SESSION_INVALID', 'Sua sessao expirou.', { status: 401 });
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 403) {
    return new FulfillmentClientError('APP_ACCESS_NOT_APPROVED', 'Seu acesso a entrega esta indisponivel.', { status: 403 });
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
    return new FulfillmentClientError('NO_ACTIVE_CART', 'Carrinho nao encontrado.', { status: 404 });
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
    return new FulfillmentClientError('FULFILLMENT_VERSION_CONFLICT', 'Fulfillment foi modificado. Recarregue e tente novamente.', { status: 409 });
  }
  return new FulfillmentClientError(
    'INTERNAL_ERROR',
    'Nao foi possivel acessar as opcoes de entrega agora.',
  );
}
