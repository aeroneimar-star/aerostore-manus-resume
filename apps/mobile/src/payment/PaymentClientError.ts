import type { PaymentErrorCode } from './contracts';

export class PaymentClientError extends Error {
  readonly code: PaymentErrorCode;
  readonly httpStatus?: number;

  constructor(code: PaymentErrorCode, message: string, httpStatus?: number) {
    super(message);
    this.name = 'PaymentClientError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export function toPaymentClientError(err: unknown): PaymentClientError {
  if (err instanceof PaymentClientError) return err;
  return new PaymentClientError('INTERNAL_ERROR', 'Erro ao comunicar com o serviço de pagamento.');
}
