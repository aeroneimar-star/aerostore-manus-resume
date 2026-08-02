import type { CartErrorCode } from './contracts';

export class CartClientError extends Error {
  readonly code: CartErrorCode;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: CartErrorCode,
    message: string,
    options: { status?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'CartClientError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export function toCartClientError(error: unknown): CartClientError {
  if (error instanceof CartClientError) return error;
  if (error && typeof error === 'object' && 'status' in error && error.status === 401) {
    return new CartClientError('APP_SESSION_INVALID', 'Sua sessao expirou.', { status: 401 });
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 403) {
    return new CartClientError('APP_ACCESS_NOT_APPROVED', 'Seu acesso ao carrinho esta indisponivel.', { status: 403 });
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
    return new CartClientError('CART_NOT_FOUND', 'Carrinho nao encontrado.', { status: 404 });
  }
  return new CartClientError(
    'INTERNAL_ERROR',
    'Nao foi possivel atualizar o carrinho agora.',
  );
}
