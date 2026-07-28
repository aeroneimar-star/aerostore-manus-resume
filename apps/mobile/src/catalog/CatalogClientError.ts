import type { B2cApiErrorCode } from './contracts';

export class CatalogClientError extends Error {
  readonly code: B2cApiErrorCode;
  readonly status?: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: B2cApiErrorCode,
    message: string,
    options: { status?: number; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'CatalogClientError';
    this.code = code;
    this.status = options.status;
    this.details = options.details;
  }
}

export function toCatalogClientError(error: unknown): CatalogClientError {
  if (error instanceof CatalogClientError) {
    return error;
  }
  return new CatalogClientError(
    'INTERNAL_ERROR',
    'Não foi possível carregar o catálogo agora.',
  );
}
