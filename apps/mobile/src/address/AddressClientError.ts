import type { AddressErrorCode } from './contracts';

export class AddressClientError extends Error {
  readonly code: AddressErrorCode;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AddressErrorCode,
    message: string,
    options: { status?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AddressClientError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export function toAddressClientError(error: unknown): AddressClientError {
  if (error instanceof AddressClientError) return error;
  if (error && typeof error === 'object' && 'status' in error && error.status === 401) {
    return new AddressClientError('APP_SESSION_INVALID', 'Sua sessao expirou.', { status: 401 });
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 403) {
    return new AddressClientError('APP_ACCESS_NOT_APPROVED', 'Seu acesso aos enderecos esta indisponivel.', { status: 403 });
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
    return new AddressClientError('ADDRESS_NOT_FOUND', 'Endereco nao encontrado.', { status: 404 });
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 409) {
    return new AddressClientError('ADDRESS_VERSION_CONFLICT', 'Endereco foi modificado. Recarregue e tente novamente.', { status: 409 });
  }
  return new AddressClientError(
    'INTERNAL_ERROR',
    'Nao foi possivel acessar os enderecos agora.',
  );
}
